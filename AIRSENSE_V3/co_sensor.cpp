#include "co_sensor.h"
#include "config.h"
#include "rtc_state.h"
#include <Preferences.h>

static const float VCC = 3.298;
static const float RL  = 4700.0;
float R0 = 77887.0;

static const float PPM_REF   = 150.0;
static const float RATIO_REF = 0.33;
static const float N         = 0.33;

static Preferences prefs;

// ---- Ring sampel bertanda waktu di RTC memory (bertahan lewat deep sleep) ----
// 1 sampel per ~150 dtk (dan 1 saat akan tidur). 256 slot > 8 jam / 150 dtk = 192.
#define CO_SLOTS 256
static const uint32_t CO_COMMIT_PERIOD_MS = 150000UL;
static const uint64_t CO_WINDOW_MS        = 8ULL * 3600ULL * 1000ULL;

static RTC_DATA_ATTR float    ringV[CO_SLOTS];   // ppm
static RTC_DATA_ATTR uint32_t ringT[CO_SLOTS];   // uptime (detik)
static RTC_DATA_ATTR uint16_t ringHead = 0;      // slot berikutnya yang ditulis
static RTC_DATA_ATTR uint16_t ringN    = 0;
int count = 0;

// Akumulator sejak commit terakhir (RAM, di-commit paksa sebelum tidur)
static double   accSum = 0;
static int      accN   = 0;
static uint64_t lastCommitMs = 0;

float curPpm = NAN, curRatio = NAN;
static float rsF = NAN;

void coInit(bool coldBoot) {
  prefs.begin("co", false);
  R0 = prefs.getFloat("r0", R0);
  if (coldBoot) { ringHead = 0; ringN = 0; }
  count = ringN;
  lastCommitMs = uptimeMs();
}

void coSetR0(float r0) {
  R0 = r0;
  prefs.putFloat("r0", R0);
}

static float readVoltage(int samples = 32) {
  uint32_t s = 0;
  for (int i = 0; i < samples; i++) {
    s += analogReadMilliVolts(SENSOR_PIN);
    delay(2);
  }
  return s / (float)samples / 1000.0;
}

float readRs() {
  float v = readVoltage();
  if (v < 0.02 || v >= VCC) return NAN;
  return RL * (VCC - v) / v;
}

static float ppmCurve(float ratio) {
  return PPM_REF * pow(ratio / RATIO_REF, -1.0f / N);
}

static float rsToPpm(float rs) {
  if (isnan(rs) || R0 <= 0) return NAN;
  float ppm = ppmCurve(rs / R0) - ppmCurve(1.0f);
  return fminf(fmaxf(ppm, 0.0f), 5000.0f);
}

void coSecondTick() {
  float rs = readRs();
  if (isnan(rs)) rsF = NAN;
  else           rsF = isnan(rsF) ? rs : 0.9f * rsF + 0.1f * rs;

  curPpm   = rsToPpm(rsF);
  curRatio = rsF / R0;
  if (!isnan(curPpm)) { accSum += curPpm; accN++; }
}

float avg8h() {
  uint64_t nowS = uptimeMs() / 1000ULL;
  uint64_t winS = CO_WINDOW_MS / 1000ULL;
  double s = 0; int n = 0;
  for (int i = 0; i < ringN; i++) {
    if (nowS - ringT[i] <= winS) { s += ringV[i]; n++; }
  }
  count = n;
  return n ? (float)(s / n) : NAN;
}

void coCommit(uint64_t nowMs, bool force) {
  if (!force && nowMs - lastCommitMs < CO_COMMIT_PERIOD_MS) return;
  lastCommitMs = nowMs;
  if (nowMs >= WARMUP_MS && accN > 0) {      // sampel selama pemanasan tidak dipakai
    ringV[ringHead] = (float)(accSum / accN);
    ringT[ringHead] = (uint32_t)(nowMs / 1000ULL);
    ringHead = (ringHead + 1) % CO_SLOTS;
    if (ringN < CO_SLOTS) ringN++;
  }
  accSum = 0; accN = 0;
}

void coReset() {
  ringHead = 0; ringN = 0; count = 0;
  accSum = 0; accN = 0;
  lastCommitMs = uptimeMs();
  rsF = NAN;
  curPpm = curRatio = NAN;
}

bool coAlert() {
  return uptimeMs() >= WARMUP_MS && !isnan(curRatio) && curRatio < ALERT_RATIO;
}
