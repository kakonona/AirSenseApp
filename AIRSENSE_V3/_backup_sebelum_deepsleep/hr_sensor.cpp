#include "hr_sensor.h"
#include "config.h"
#include <Wire.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"
#include "heartRate.h"

#ifndef INT_PIN
#define INT_PIN 6                // MAX30102 INT (open-drain, aktif LOW) -> IO6
#endif

#define BUFFER_LEN  100          // dibatasi library Maxim
#define DECIM       4            // 100 sps -> 25 sps untuk algoritma SpO2
#define SPO2_STEP   25           // hitung SpO2 tiap 25 sampel baru (1 detik)
#define IR_MIN      50000        // di bawah ini = tidak ada jari
#define IR_MAX      250000       // di atas ini = saturasi ADC
#define SETTLE_MS   3000         // abaikan beat 3 detik pertama setelah jari terdeteksi
#define MED_N       5
#define HR_JUMP     20           // tolak lompatan HR > 20 bpm dari nilai terfilter
#define MAX_REJECT  5

// ---- Standby (sensor dimatikan saat tidak ada jari) ----
#define NOFINGER_SLEEP_SAMPLES 300     // 300 sampel @100 sps = 3 detik tanpa jari -> matikan sensor
#define PROBE_PERIOD_MS        10000   // saat standby, cek jari tiap 10 detik
#define PROBE_SAMPLES          2       // sampel ke-1 dibuang (settling), sampel ke-2 dinilai
#define PROBE_TIMEOUT_MS       100     // batas tunggu INT turun

// ---------- Data publik (dibaca display, power, alert, .ino) ----------
int  heartRate     = 0;
int  spo2          = 0;
bool fingerPresent = false;

// ---------- Median filter kecil ----------
struct MedianFilter {
  int32_t v[MED_N];
  byte n = 0, idx = 0;

  void reset() { n = 0; idx = 0; }

  void push(int32_t x) {
    v[idx] = x;
    idx = (idx + 1) % MED_N;
    if (n < MED_N) n++;
  }

  int32_t get() {
    int32_t t[MED_N];
    for (byte i = 0; i < n; i++) t[i] = v[i];
    for (byte i = 1; i < n; i++) {
      int32_t k = t[i];
      int j = i - 1;
      while (j >= 0 && t[j] > k) { t[j + 1] = t[j]; j--; }
      t[j + 1] = k;
    }
    return t[n / 2];
  }
};

// ---------- State (semua static agar tidak bentrok dengan modul lain) ----------
static MAX30105 particleSensor;
static bool     hrReady = false;

static uint32_t irBuf[BUFFER_LEN];
static uint32_t redBuf[BUFFER_LEN];
static byte     bufCount = 0, newSinceCalc = 0;
static uint32_t irAcc = 0, redAcc = 0;
static byte     accN = 0;

static bool          fingerOn = false;
static unsigned long fingerSince = 0, lastBeat = 0;

static MedianFilter hrMed, spo2Med;
static float hrEma = 0, spo2Ema = 0;
static bool  hrInit = false, spo2Init = false;
static byte  hrReject = 0;
static bool  saturated = false;

static int32_t spo2Raw = 0, maximHr = 0;
static int8_t  spo2Valid = 0, maximHrValid = 0;

enum SensorMode { MODE_ACTIVE, MODE_STANDBY_SLEEP, MODE_STANDBY_PROBE, MODE_PAUSED };
static SensorMode    sensorMode = MODE_ACTIVE;
static uint16_t      noFingerSamples = 0;
static unsigned long nextProbe = 0, probeStart = 0;
static byte          probeSamples = 0, intMissCount = 0;
static uint32_t      probeIr = 0;

static void resetAll() {
  bufCount = 0; newSinceCalc = 0;
  irAcc = 0; redAcc = 0; accN = 0;
  lastBeat = 0;
  hrMed.reset(); spo2Med.reset();
  hrInit = false; spo2Init = false;
  hrReject = 0; saturated = false;
}

// ---------- Standby: matikan / probe / bangun ----------
static void enterStandby() {
  particleSensor.shutDown();           // konfigurasi tetap tersimpan di register
  resetAll();
  fingerOn = false;
  noFingerSamples = 0;
  sensorMode = MODE_STANDBY_SLEEP;
  nextProbe = millis() + PROBE_PERIOD_MS;
  Serial.printf("[HR] Tidak ada jari: sensor dimatikan (probe tiap %lu s)\n",
                (unsigned long)(PROBE_PERIOD_MS / 1000));
}

static void startProbe() {
  particleSensor.getINT1();            // bersihkan INT lama supaya pin kembali HIGH
  particleSensor.getINT2();
  particleSensor.enableDATARDY();      // INT turun tiap ada sampel baru (PPG_RDY)
  particleSensor.clearFIFO();          // saat masih shutdown, tidak ada sampel masuk
  particleSensor.wakeUp();
  probeSamples = 0;
  probeStart = millis();
  sensorMode = MODE_STANDBY_PROBE;
}

static void finishProbe(bool finger) {
  particleSensor.disableDATARDY();     // mode aktif membaca FIFO langsung, INT tidak dipakai
  particleSensor.getINT1();
  if (finger) {
    particleSensor.clearFIFO();
    resetAll();
    fingerOn = false;
    noFingerSamples = 0;
    sensorMode = MODE_ACTIVE;
    Serial.println("[HR] Jari terdeteksi: sensor aktif");
  } else {
    particleSensor.shutDown();
    sensorMode = MODE_STANDBY_SLEEP;
    nextProbe = millis() + PROBE_PERIOD_MS;
  }
}

static void handleProbe() {
  bool intLow  = (digitalRead(INT_PIN) == LOW);
  bool timeout = (millis() - probeStart > PROBE_TIMEOUT_MS);
  if (!intLow && !timeout) return;

  if (intLow) {
    intMissCount = 0;
  } else if (++intMissCount == 3) {
    // Fallback: tetap baca FIFO lewat I2C supaya deteksi jari tidak mati total.
    Serial.printf("[HR] PERINGATAN: INT (IO%d) tidak pernah turun. Cek kabel INT / pull-up.\n", INT_PIN);
  }

  particleSensor.check();
  bool got = false;
  while (particleSensor.available()) {
    probeIr = particleSensor.getFIFOIR();
    particleSensor.nextSample();
    got = true;
  }
  particleSensor.getINT1();            // lepaskan INT

  if (intLow && ++probeSamples < PROBE_SAMPLES) return;   // tunggu sampel berikutnya
  finishProbe(got && probeIr >= IR_MIN);
}

// ---------- HR dari checkForBeat ----------
static void acceptHr(float bpm) {
  if (hrInit && fabs(bpm - hrEma) > HR_JUMP) {
    if (++hrReject >= MAX_REJECT) {      // lompatan berulang = kondisi memang berubah
      hrMed.reset(); hrInit = false; hrReject = 0;
    }
    return;
  }
  hrReject = 0;
  hrMed.push((int32_t)bpm);
  if (hrMed.n >= 3) {
    float m = hrMed.get();
    hrEma = hrInit ? (0.7f * hrEma + 0.3f * m) : m;
    hrInit = true;
  }
}

// ---------- SpO2 dari algoritma Maxim ----------
static void computeSpo2() {
  uint32_t irMax = 0;
  for (byte i = 0; i < BUFFER_LEN; i++) if (irBuf[i] > irMax) irMax = irBuf[i];
  saturated = (irMax > IR_MAX);
  if (saturated) return;

  maxim_heart_rate_and_oxygen_saturation(irBuf, BUFFER_LEN, redBuf,
                                         &spo2Raw, &spo2Valid, &maximHr, &maximHrValid);

  if (spo2Valid && spo2Raw >= 85 && spo2Raw <= 100) {
    spo2Med.push(spo2Raw);
    if (spo2Med.n >= 3) {
      float m = spo2Med.get();
      spo2Ema = spo2Init ? (0.7f * spo2Ema + 0.3f * m) : m;
      spo2Init = true;
    }
  }
}

// ---------- Proses tiap sampel 100 sps ----------
static void processSample(uint32_t ir, uint32_t red) {
  if (ir < IR_MIN) {
    if (noFingerSamples < 0xFFFF) noFingerSamples++;
    if (fingerOn) { fingerOn = false; resetAll(); }
    return;
  }
  noFingerSamples = 0;
  if (!fingerOn) {
    fingerOn = true;
    fingerSince = millis();
    resetAll();
  }

  // HR: wajib dipanggil di setiap sampel agar filter internalnya konsisten
  if (checkForBeat(ir) && (millis() - fingerSince > SETTLE_MS)) {
    unsigned long now = millis();
    if (lastBeat > 0) {
      float bpm = 60000.0f / (now - lastBeat);
      if (bpm >= 40 && bpm <= 180) acceptHr(bpm);
    }
    lastBeat = now;
  }

  // SpO2: decimasi 4 sampel -> 1 sampel (25 sps)
  irAcc += ir; redAcc += red;
  if (++accN < DECIM) return;
  uint32_t irAvg = irAcc / DECIM, redAvg = redAcc / DECIM;
  irAcc = 0; redAcc = 0; accN = 0;

  if (bufCount < BUFFER_LEN) {
    irBuf[bufCount] = irAvg;
    redBuf[bufCount] = redAvg;
    bufCount++;
  } else {
    memmove(irBuf,  irBuf  + 1, (BUFFER_LEN - 1) * sizeof(uint32_t));
    memmove(redBuf, redBuf + 1, (BUFFER_LEN - 1) * sizeof(uint32_t));
    irBuf[BUFFER_LEN - 1]  = irAvg;
    redBuf[BUFFER_LEN - 1] = redAvg;
  }
  newSinceCalc++;

  if (bufCount == BUFFER_LEN && newSinceCalc >= SPO2_STEP) {
    newSinceCalc = 0;
    computeSpo2();
  }
}

// ---------- Publikasi ke variabel global ----------
static void publish() {
  if (sensorMode == MODE_PAUSED) {     // tidur siklus: heartRate/spo2 = hasil terakhir
    fingerPresent = false;
    return;
  }
  fingerPresent = (sensorMode == MODE_ACTIVE) && fingerOn;
  bool live = fingerPresent && !saturated && (millis() - fingerSince >= SETTLE_MS);
  heartRate = (live && hrInit)   ? (int)roundf(hrEma)   : 0;
  spo2      = (live && spo2Init) ? (int)roundf(spo2Ema) : 0;
}

// ---------- API ----------
bool hrBegin() {
  pinMode(INT_PIN, INPUT_PULLUP);      // INT open-drain aktif LOW

  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[HR] MAX30102 tidak terdeteksi (cek kabel SDA/SCL, alamat 0x57)");
    hrReady = false;
    return false;
  }

  byte ledBrightness = 60;    // target IR sekitar 80000-200000
  byte sampleAverage = 4;
  byte ledMode       = 2;     // Red + IR
  int  sampleRate    = 400;   // 400 / 4 = 100 sps efektif
  int  pulseWidth    = 411;
  int  adcRange      = 4096;

  particleSensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);

  // Mode aktif membaca FIFO langsung; INT hanya dipakai saat probe standby.
  particleSensor.disableAFULL();
  particleSensor.disableDATARDY();
  particleSensor.disableALCOVF();
  particleSensor.getINT1();            // bersihkan flag PWR_RDY sisa power-up
  particleSensor.getINT2();

  resetAll();
  fingerOn = false;
  noFingerSamples = 0;
  sensorMode = MODE_ACTIVE;
  hrReady = true;
  Serial.println("[HR] MAX30102 siap. Tempelkan jari, tahan diam dengan tekanan ringan.");
  return true;
}

void pollHR() {
  if (!hrReady) return;

  switch (sensorMode) {
    case MODE_ACTIVE:
      particleSensor.check();
      while (particleSensor.available()) {
        uint32_t ir  = particleSensor.getFIFOIR();
        uint32_t red = particleSensor.getFIFORed();
        particleSensor.nextSample();
        processSample(ir, red);
      }
      if (noFingerSamples >= NOFINGER_SLEEP_SAMPLES) enterStandby();
      break;

    case MODE_STANDBY_SLEEP:
      if ((long)(millis() - nextProbe) >= 0) startProbe();
      break;

    case MODE_STANDBY_PROBE:
      handleProbe();
      break;

    case MODE_PAUSED:
      break;
  }

  publish();
}

int hrState() {
  if (!hrReady) return 0;                                   // SENSOR ERR
  if (sensorMode != MODE_ACTIVE || !fingerOn) return 1;     // TEMPEL JARI
  return 2;                                                 // MENGUKUR...
}

// Sensor sudah standby sendiri saat tidak ada jari, dan probe tetap jalan
// supaya jari bisa membangunkan layar (lihat power.cpp). Jadi tidak dimatikan total.
void hrSleep() {
  if (hrReady && sensorMode == MODE_ACTIVE && !fingerOn) enterStandby();
}

void hrWake() {
  if (hrReady && sensorMode == MODE_STANDBY_SLEEP) nextProbe = millis();   // probe sekarang
}

// ---------- Tidur siklus (dipanggil cycle.cpp) ----------
void hrPause() {
  if (!hrReady || sensorMode == MODE_PAUSED) return;
  if (sensorMode == MODE_STANDBY_PROBE) {      // batalkan probe yang sedang berjalan
    particleSensor.disableDATARDY();
    particleSensor.getINT1();
  }
  particleSensor.shutDown();
  resetAll();
  fingerOn = false;
  noFingerSamples = 0;
  sensorMode = MODE_PAUSED;
  fingerPresent = false;                       // heartRate/spo2 sengaja dibiarkan (hasil terakhir)
}

void hrResume() {
  if (!hrReady || sensorMode != MODE_PAUSED) return;
  particleSensor.getINT1();
  particleSensor.getINT2();
  particleSensor.clearFIFO();                  // urutan sama seperti startProbe(): clear lalu wakeUp
  particleSensor.wakeUp();
  resetAll();
  fingerOn = false;
  noFingerSamples = 0;
  sensorMode = MODE_ACTIVE;
  heartRate = 0;                               // jendela baru: hasil lama dikosongkan
  spo2 = 0;
}