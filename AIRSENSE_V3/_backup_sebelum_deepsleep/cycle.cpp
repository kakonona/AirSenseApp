#include "cycle.h"
#include "config.h"
#include "pm_sensor.h"
#include "hr_sensor.h"
#include "co_sensor.h"

static CycleState    state     = CY_WARMUP;
static bool          sensorsOn = true;
static unsigned long t0        = 0;

void cycleBegin() {
  state = CY_WARMUP;
  sensorsOn = true;
  t0 = millis();
}

CycleState cycleState()    { return state; }
bool       cycleSensorsOn() { return sensorsOn; }

const char* cycleName() {
  switch (state) {
    case CY_WARMUP:  return "WARMUP";
    case CY_MEASURE: return "UKUR";
    default:         return "TIDUR";
  }
}

unsigned long cycleRemainingS() {
  unsigned long now = millis();
  switch (state) {
    case CY_WARMUP:  return (now < WARMUP_MS) ? (WARMUP_MS - now) / 1000UL : 0;
    case CY_MEASURE: return (now - t0 < CYCLE_MEASURE_MS) ? (CYCLE_MEASURE_MS - (now - t0)) / 1000UL : 0;
    default:         return (now - t0 < CYCLE_SLEEP_MS)   ? (CYCLE_SLEEP_MS   - (now - t0)) / 1000UL : 0;
  }
}

static bool pmOk()     { return pmSettled() && !pmObstructed; }
static bool coOk()     { return !isnan(curPpm); }
static bool vitalsOk() { return heartRate > 0 && spo2 > 0; }

static bool measurementDone() {
  if (!pmOk() || !coOk()) return false;
  if (CYCLE_NEED_VITALS && !vitalsOk()) return false;
  return true;
}

static void startMeasure(unsigned long now) {
  state = CY_MEASURE;
  t0 = now;
  if (sensorsOn) {
    // transisi dari warm-up: sensor sudah jalan terus, tidak perlu dibangunkan
    Serial.printf("[CYC] Warm-up selesai. Siklus: ukur maks %lu s, tidur %lu s\n",
                  CYCLE_MEASURE_MS / 1000UL, CYCLE_SLEEP_MS / 1000UL);
    return;
  }
  bool ok = pmResume();
  hrResume();
  sensorsOn = true;
  Serial.printf("[CYC] Mulai ukur (maks %lu s)%s\n", CYCLE_MEASURE_MS / 1000UL,
                ok ? "" : " | PERINGATAN: BMV080 gagal dilanjutkan");
}

static void startSleep(unsigned long now, bool done) {
  unsigned long dur = (now - t0) / 1000UL;
  if (done) {
    Serial.printf("[CYC] Lengkap dalam %lu s\n", dur);
  } else {
    Serial.printf("[CYC] Batas %lu s tercapai | PM %s  CO %s  HR/SpO2 %s\n", dur,
                  pmOk() ? "ok" : "BELUM", coOk() ? "ok" : "BELUM", vitalsOk() ? "ok" : "BELUM");
  }
  pmSleep();
  hrPause();
  sensorsOn = false;
  state = CY_SLEEP;
  t0 = now;
  Serial.printf("[CYC] Tidur %lu s\n", CYCLE_SLEEP_MS / 1000UL);
}

void cycleSecond() {
  unsigned long now = millis();
  switch (state) {
    case CY_WARMUP:
      if (now >= WARMUP_MS) startMeasure(now);
      break;

    case CY_MEASURE: {
      bool done = measurementDone();
      if (done || now - t0 >= CYCLE_MEASURE_MS) startSleep(now, done);
      break;
    }

    case CY_SLEEP:
      if (now - t0 >= CYCLE_SLEEP_MS) startMeasure(now);
      break;
  }
}