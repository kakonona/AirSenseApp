#include "ble.h"
#include "config.h"
#include "pm_sensor.h"
#include "co_sensor.h"
#include "hr_sensor.h"
#include "rtc_state.h"
#include "aqi.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── Harus SAMA dengan aplikasi (src/lib/device-data.ts) ──
#define SERVICE_UUID   "a1b2c3d4-0001-4a5b-9c8d-0123456789ab"
#define DATA_CHAR_UUID "a1b2c3d4-0002-4a5b-9c8d-0123456789ab"   // NOTIFY  ESP -> app
#define ACK_CHAR_UUID  "a1b2c3d4-0003-4a5b-9c8d-0123456789ab"   // WRITE   app -> ESP
#define DEVICE_NAME    "AirSense"   // harus diawali "AirSense"

#define MAGIC     0xA5
#define ACK_MAGIC 0xA6
#define VERSION   3
#define FRAME_LEN 20                 // muat dalam 1 notify (MTU default 23 -> payload 20)
#define READV_DELAY_MS 300           // jeda sebelum advertising ulang

#define FLAG_FINGER  0x01
#define FLAG_FINAL   0x02
#define FLAG_BACKLOG 0x04

#define BACKLOG_MAX         24       // 24 x 150 dtk = 1 jam data tanpa HP
#define BACKLOG_RESEND_MS   400      // jeda kirim ulang record backlog yang belum di-ACK

/*
  Frame v3 (20 byte, little-endian):
  [0] 0xA5  [1] versi 3
  [2-3] PM2.5 x10  [4-5] PM10 x10  [6-7] CO ppm x100
  [8] SpO2 %  [9] BPM
  [10-11] seq (id record; ACK memakai nilai ini)
  [12-13] AQI (0xFFFF = tidak tersedia)
  [14] flags: bit0 jari, bit1 final, bit2 backlog
  [15-18] umur data dalam detik (0 = sekarang)
  [19] CRC-8 byte 0..18
*/

struct Record {
  uint16_t pm25, pm10, co, aqi, seq;
  uint8_t  spo2, bpm, flags;
  uint32_t tS;                       // uptime (detik) saat diukur
};

static BLE2902*           cccd    = nullptr;
static BLEServer*         pServer = nullptr;
static BLECharacteristic* pChar   = nullptr;
static volatile bool     connected = false;
static volatile bool     needAdv   = false;
static volatile uint32_t dropAt    = 0;
static volatile bool     ackPending = false;
static volatile uint16_t ackSeq     = 0;
static bool              wasConnected = false;
static bool              bleOn = false;

static RTC_DATA_ATTR uint16_t seq = 0;                 // lanjut lintas deep sleep
static RTC_DATA_ATTR Record   backlog[BACKLOG_MAX];    // urut dari yang tertua
static RTC_DATA_ATTR uint8_t  blCount = 0;

static Record        finalRec;
static bool          finalFrozen = false;
static bool          finalAcked  = false;
static unsigned long blLastSend  = 0;

static uint32_t nowS() { return (uint32_t)(uptimeMs() / 1000ULL); }

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    if (cccd) cccd->setNotifications(false);   // status subscribe lama dibuang
    connected = true;
  }
  void onDisconnect(BLEServer*) override {
    connected = false;
    dropAt = millis();
    needAdv = true;
  }
};

// ACK dari aplikasi: [0xA6, seq lo, seq hi]. Diproses di loop (bleTick), bukan di callback.
class AckCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();
    const uint8_t* d = (const uint8_t*)v.c_str();
    if (v.length() >= 3 && d[0] == ACK_MAGIC) {
      ackSeq = (uint16_t)(d[1] | (d[2] << 8));
      ackPending = true;
    }
  }
};

static uint8_t crc8(const uint8_t* data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
  }
  return crc;
}

static void putU16(uint8_t* buf, int idx, uint16_t val) {
  buf[idx]     = val & 0xFF;
  buf[idx + 1] = (val >> 8) & 0xFF;
}

static void putU32(uint8_t* buf, int idx, uint32_t val) {
  for (int i = 0; i < 4; i++) buf[idx + i] = (val >> (8 * i)) & 0xFF;
}

// NaN / negatif -> 0, dibatasi 65535 agar tidak overflow.
static uint16_t scaled(float v, float mul) {
  if (isnan(v) || v < 0) return 0;
  long r = lroundf(v * mul);
  return (r > 65535) ? 65535 : (uint16_t)r;
}

// Nilai sensor saat ini -> record (tanpa seq)
static Record snapshot() {
  Record r;
  bool warm = uptimeMs() < WARMUP_MS;              // CO belum valid selama pemanasan
  bool pmValid = pmSettled() && !pmObstructed;     // PM belum stabil / tertutup = 0
  r.pm25  = pmValid ? scaled(pm2_5, 10.0f) : 0;
  r.pm10  = pmValid ? scaled(pm10, 10.0f) : 0;
  r.co    = warm ? 0 : scaled(curPpm, 100.0f);
  r.spo2  = (uint8_t)constrain(spo2, 0, 100);
  r.bpm   = (uint8_t)constrain(heartRate, 0, 255);
  r.aqi   = aqiMax >= 0 ? (uint16_t)aqiMax : 0xFFFF;
  r.flags = fingerPresent ? FLAG_FINGER : 0;
  r.tS    = nowS();
  r.seq   = 0;
  return r;
}

static void notifyRecord(const Record& r, uint8_t extraFlags, uint32_t ageS) {
  uint8_t f[FRAME_LEN] = {0};
  f[0] = MAGIC;
  f[1] = VERSION;
  putU16(f, 2, r.pm25);
  putU16(f, 4, r.pm10);
  putU16(f, 6, r.co);
  f[8] = r.spo2;
  f[9] = r.bpm;
  putU16(f, 10, r.seq);
  putU16(f, 12, r.aqi);
  f[14] = r.flags | extraFlags;
  putU32(f, 15, ageS);
  f[19] = crc8(f, FRAME_LEN - 1);
  pChar->setValue(f, FRAME_LEN);
  pChar->notify();
}

static bool canNotify() {
  return bleOn && connected && cccd && cccd->getNotifications();
}

static void backlogRemove(uint16_t s) {
  for (uint8_t i = 0; i < blCount; i++) {
    if (backlog[i].seq != s) continue;
    for (uint8_t j = i; j + 1 < blCount; j++) backlog[j] = backlog[j + 1];
    blCount--;
    Serial.printf("[BLE] Backlog seq %u di-ACK, sisa %u\n", s, blCount);
    return;
  }
}

static void backlogPush(const Record& r) {
  if (blCount >= BACKLOG_MAX) {                   // penuh: buang yang paling lama
    for (uint8_t j = 0; j + 1 < BACKLOG_MAX; j++) backlog[j] = backlog[j + 1];
    blCount = BACKLOG_MAX - 1;
  }
  backlog[blCount++] = r;
}

static void startBle() {
  connected = false; needAdv = false; wasConnected = false;
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCB());

  BLEService* svc = pServer->createService(SERVICE_UUID);
  pChar = svc->createCharacteristic(DATA_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  cccd = new BLE2902();
  pChar->addDescriptor(cccd);

  BLECharacteristic* ack = svc->createCharacteristic(
      ACK_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  ack->setCallbacks(new AckCB());
  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinInterval(0x20);           // 20 ms: app auto-reconnect cepat menemukan perangkat
  adv->setMaxInterval(0x40);           // 40 ms
  BLEDevice::startAdvertising();
  bleOn = true;
  Serial.printf("[BLE] advertising sebagai " DEVICE_NAME " | backlog %u record\n", blCount);
}

void bleStop() {
  if (!bleOn) return;
  BLEDevice::stopAdvertising();
  BLEDevice::deinit(true);
  bleOn = false;
  connected = false;
}

void bleTick() {
  if (!bleOn) {                         // BLE baru hidup setelah pemanasan selesai
    if (uptimeMs() >= WARMUP_MS) startBle();
    return;
  }
  if (!connected && needAdv && millis() - dropAt >= READV_DELAY_MS) {
    needAdv = false;
    BLEDevice::startAdvertising();
  }
  if (connected != wasConnected) {
    wasConnected = connected;
    Serial.println(connected ? "[BLE] terhubung" : "[BLE] terputus, advertising ulang");
  }

  if (ackPending) {
    ackPending = false;
    uint16_t s = ackSeq;
    if (finalFrozen && !finalAcked && s == finalRec.seq) {
      finalAcked = true;
      Serial.printf("[BLE] Final seq %u di-ACK aplikasi\n", s);
    } else {
      backlogRemove(s);
    }
  }

  // Kirim backlog (tertua dulu), ulangi sampai di-ACK
  if (blCount > 0 && canNotify() && millis() - blLastSend >= BACKLOG_RESEND_MS) {
    blLastSend = millis();
    const Record& r = backlog[0];
    uint32_t now = nowS();
    notifyRecord(r, FLAG_BACKLOG, now > r.tS ? now - r.tS : 0);
  }
}

void bleFreezeFinal() {
  finalRec = snapshot();
  finalRec.seq = seq++;
  finalFrozen = true;
  finalAcked = false;
}

bool bleFinalAcked()     { return finalFrozen && finalAcked; }
uint8_t bleBacklogCount() { return blCount; }

void bleStashFinal() {
  if (!finalFrozen || finalAcked) return;
  backlogPush(finalRec);
  finalAcked = true;                    // sudah aman di RTC
  Serial.printf("[BLE] Final seq %u belum di-ACK -> backlog (%u record)\n", finalRec.seq, blCount);
}

bool bleSend() {
  if (!canNotify()) return false;
  if (finalFrozen && !finalAcked) {
    notifyRecord(finalRec, FLAG_FINAL, 0);   // snapshot final, dikirim ulang sampai di-ACK
    return true;
  }
  Record r = snapshot();
  r.seq = seq++;
  notifyRecord(r, 0, 0);
  return true;
}

bool bleConnected() { return bleOn && connected; }
bool bleStarted()   { return bleOn; }
