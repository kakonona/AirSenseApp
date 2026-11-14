#include "co_sensor.h"
#include "config.h"
#include <Preferences.h>

static const float VCC = 3.298;
static const float RL  = 4700.0;
float R0 = 77887.0;

static const float PPM_REF   = 150.0;
static const float RATIO_REF = 0.33;
static const float N         = 0.33;

static Preferences prefs;

static float  buf[WINDOW];
static int    idx = 0;
int           count = 0;
static double sum = 0;

static float minuteSum = 0;
static int   minuteN = 0;

float curPpm = NAN, curRatio = NAN;
static float rsF = NAN;

void coInit() {
  prefs.begin("co", false);
  R0 = prefs.getFloat("r0", R0);
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

static void addSample(float x) {
  if (count == WINDOW) sum -= buf[idx]; else count++;
  buf[idx] = x;
  sum += x;
  idx = (idx + 1) % WINDOW;
}

float avg8h() { return count ? (float)(sum / count) : NAN; }

void coSecondTick() {
  float rs = readRs();
  if (isnan(rs)) rsF = NAN;
  else           rsF = isnan(rsF) ? rs : 0.9f * rsF + 0.1f * rs;

  curPpm   = rsToPpm(rsF);
  curRatio = rsF / R0;
  if (!isnan(curPpm)) { minuteSum += curPpm; minuteN++; }
}

void coMinuteTick(unsigned long now) {
  if (now >= WARMUP_MS && minuteN > 0) addSample(minuteSum / minuteN);
  minuteSum = 0; minuteN = 0;
}

void coReset() {
  count = 0; idx = 0; sum = 0;
  minuteSum = 0; minuteN = 0;
  rsF = NAN;
  curPpm = curRatio = NAN;
}

bool coAlert() {
  return millis() >= WARMUP_MS && !isnan(curRatio) && curRatio < ALERT_RATIO;
}