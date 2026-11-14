#include "cycle.h"
#include "config.h"
#include "rtc_state.h"
#include "pm_sensor.h"
#include "hr_sensor.h"
#include "co_sensor.h"

static CycleState    state      = CY_WARMUP;
static bool          windowDone = false;
static bool          noFinger   = false;
static unsigned long t0         = 0;      // millis() awal jendela (jendela = waktu bangun saja)
static unsigned long waitUntil  = 0;      // batas tunggu BLE (millis())

CycleState cycleState()      { return state; }
bool       cycleWantsSleep() { return state == CY_MEASURE && windowDone; }
bool       cycleWaitExpired() { return cycleWantsSleep() && (long)(millis() - waitUntil) >= 0; }

const char* cycleName() {
  if (state == CY_WARMUP) return "WARMUP";
  if (windowDone) return noFinger ? "NOJARI" : "SELESAI";
  return "UKUR";
}

// Tanpa jari: total siklus tetap 30 + 120 dtk (sisa jendela ikut ditidurkan).
uint32_t cycleSleepMs() {
  if (!noFinger) return CYCLE_SLEEP_MS;
  unsigned long el = millis() - t0;
  unsigned long rest = (el < CYCLE_MEASURE_MS) ? (CYCLE_MEASURE_MS - el) : 0;
  return (uint32_t)(rest + CYCLE_SLEEP_MS);
}

unsigned long cycleRemainingS() {
  if (state == CY_WARMUP) {
    uint64_t up = uptimeMs();
    return (up < WARMUP_MS) ? (unsigned long)((WARMUP_MS - up) / 1000ULL) : 0;
  }
  if (windowDone) {
    long left = (long)(waitUntil - millis());
    return left > 0 ? (unsigned long)left / 1000UL : 0;   // sisa tunggu BLE
  }
  unsigned long el = millis() - t0;
  return (el < CYCLE_MEASURE_MS) ? (CYCLE_MEASURE_MS - el) / 1000UL : 0;
}

static bool pmOk()     { return pmSettled() && !pmObstructed; }
static bool coOk()     { return !isnan(curPpm); }
static bool vitalsOk() { return heartRate > 0 && spo2 > 0; }

static bool measurementDone() {
  if (!pmOk() || !coOk()) return false;
  if (CYCLE_NEED_VITALS && !vitalsOk()) return false;
  return true;
}

// Jendela selesai: mulai menunggu frame final terkirim lewat BLE (dibatasi waktu).
static void finishWindow(bool nf) {
  windowDone = true;
  noFinger = nf;
  unsigned long el = millis() - t0;
  waitUntil = nf ? t0 + ((el > CYCLE_NOFINGER_AWAKE_MS) ? el : CYCLE_NOFINGER_AWAKE_MS)
                 : millis() + CYCLE_BLE_WAIT_MS;
}

void cycleBegin() {
  t0 = millis();
  windowDone = false;
  noFinger = false;
  if (uptimeMs() < WARMUP_MS) {
    state = CY_WARMUP;
    Serial.printf("[CYC] Pemanasan %lu s lagi\n", cycleRemainingS());
  } else {
    state = CY_MEASURE;
    Serial.printf("[CYC] Jendela ukur (maks %lu s)\n", CYCLE_MEASURE_MS / 1000UL);
  }
}

void cycleSecond() {
  if (state == CY_WARMUP) {
    if (uptimeMs() >= WARMUP_MS) {
      state = CY_MEASURE;
      t0 = millis();
      windowDone = false;
      noFinger = false;
      Serial.printf("[CYC] Warm-up selesai. Siklus: ukur maks %lu s, deep sleep %lu s\n",
                    CYCLE_MEASURE_MS / 1000UL, CYCLE_SLEEP_MS / 1000UL);
    }
    return;
  }

  if (windowDone) return;
  unsigned long el = millis() - t0;

  // Tanpa jari pada detik ke-CHECK: selesai, kirim data terukur, lalu tidur (maks AWAKE total).
  if (CYCLE_SLEEP_IF_NO_FINGER && !fingerPresent && el >= CYCLE_NOFINGER_CHECK_MS) {
    finishWindow(true);
    Serial.printf("[CYC] Tanpa jari pada %lu s -> kirim data terukur, tidur paling lambat di %lu s\n",
                  el / 1000UL, CYCLE_NOFINGER_AWAKE_MS / 1000UL);
    return;
  }

  if (measurementDone()) {
    finishWindow(false);
    Serial.printf("[CYC] Lengkap dalam %lu s\n", el / 1000UL);
  } else if (el >= CYCLE_MEASURE_MS) {
    finishWindow(false);
    Serial.printf("[CYC] Batas %lu s tercapai | PM %s  CO %s  HR/SpO2 %s\n", el / 1000UL,
                  pmOk() ? "ok" : "BELUM", coOk() ? "ok" : "BELUM", vitalsOk() ? "ok" : "BELUM");
  }
}
