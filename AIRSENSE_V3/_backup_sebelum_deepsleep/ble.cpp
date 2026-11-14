#include "ble.h"
#include "config.h"
#include "pm_sensor.h"
#include "co_sensor.h"
#include "hr_sensor.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── Harus SAMA dengan aplikasi ──
#define SERVICE_UUID   "a1b2c3d4-0001-4a5b-9c8d-0123456789ab"
#define DATA_CHAR_UUID "a1b2c3d4-0002-4a5b-9c8d-0123456789ab"
#define DEVICE_NAME    "AirSense"   // harus diawali "AirSense"

#define MAGIC     0xA5
#define VERSION   1
#define FRAME_LEN 14
#define READV_DELAY_MS 300           // jeda sebelum advertising ulang

static BLEServer*         pServer = nullptr;
static BLECharacteristic* pChar   = nullptr;
static volatile bool     connected = false;
static volatile bool     needAdv   = false;
static volatile uint32_t dropAt    = 0;
static bool              wasConnected = false;
static uint16_t          seq = 0;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { connected = true; }
  void onDisconnect(BLEServer*) override {
    connected = false;
    dropAt = millis();
    needAdv = true;
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

static void putU16(uint8_t* buf, int idx, uint16_t val) {  // little-endian
  buf[idx]     = val & 0xFF;
  buf[idx + 1] = (val >> 8) & 0xFF;
}

// NaN / negatif -> 0, dibatasi 65535 agar tidak overflow.
static uint16_t scaled(float v, float mul) {
  if (isnan(v) || v < 0) return 0;
  long r = lroundf(v * mul);
  return (r > 65535) ? 65535 : (uint16_t)r;
}

void bleBegin() {
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCB());

  BLEService* svc = pServer->createService(SERVICE_UUID);
  pChar = svc->createCharacteristic(DATA_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pChar->addDescriptor(new BLE2902());
  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] advertising sebagai " DEVICE_NAME);
}

void bleTick() {
  if (!connected && needAdv && millis() - dropAt >= READV_DELAY_MS) {
    needAdv = false;
    BLEDevice::startAdvertising();
  }
  if (connected != wasConnected) {
    wasConnected = connected;
    Serial.println(connected ? "[BLE] terhubung" : "[BLE] terputus, advertising ulang");
  }
}

void bleSend() {
  if (!connected) return;

  uint8_t f[FRAME_LEN] = {0};

  // CO dikirim 0 selama pemanasan (sama seperti tampilan di layar: nilai belum valid)
  bool warm = millis() < WARMUP_MS;

  f[0] = MAGIC;
  f[1] = VERSION;
  putU16(f, 2,  scaled(pm2_5, 10.0f));
  putU16(f, 4,  scaled(pm10,  10.0f));
  putU16(f, 6,  warm ? 0 : scaled(curPpm, 100.0f));
  f[8]  = (uint8_t)constrain(spo2, 0, 100);
  f[9]  = (uint8_t)constrain(heartRate, 0, 255);
  putU16(f, 10, seq);
  f[12] = fingerPresent ? 0x01 : 0x00;
  f[13] = crc8(f, FRAME_LEN - 1);

  pChar->setValue(f, FRAME_LEN);
  pChar->notify();
  seq++;
}

bool bleConnected() { return connected; }