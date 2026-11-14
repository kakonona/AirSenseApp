#include "pm_sensor.h"
#include "config.h"
#include <Wire.h>
#include "DFRobot_BMV080.h"

static DFRobot_BMV080_I2C pmSensor(&Wire, BMV_ADDR);

float pm2_5 = NAN, pm10 = NAN;
bool  pmObstructed = false;
static bool pmIsOpen = false;

// Pembacaan segar berturut-turut sejak sensor (re)start; 0 saat tertutup.
// Sampel awal setelah bangun belum stabil, jadi tidak dipakai untuk NowCast / penentu selesai.
#define PM_SETTLE_READS 10
static int pmFresh = 0;

// Bucket per jam di RTC memory (bertahan lewat deep sleep). indeks 0 = jam terbaru
static RTC_DATA_ATTR float    h25[NC_HOURS], h10[NC_HOURS];
RTC_DATA_ATTR int             hFilled = 0;
static RTC_DATA_ATTR double   hSum25 = 0, hSum10 = 0;
static RTC_DATA_ATTR int      hN = 0;
static RTC_DATA_ATTR uint64_t hourStartMs = 0;

bool pmBegin() { return pmSensor.begin() == 0; }

bool pmOpen() {
  pmIsOpen = !pmSensor.openBmv080();
  return pmIsOpen;
}

void pmConfigure() {
  pmSensor.setObstructionDetection(true);
  pmSensor.setDoVibrationFiltering(true);
  pmSensor.setMeasurementAlgorithm(BALANCED);
  pmSensor.setBmv080Mode(CONTINUOUS_MODE);
  pmFresh = 0;
}

void pmShutdown() {
  if (!pmIsOpen) return;
  pmSensor.stopBmv080();            // close hanya valid setelah stop
  pmSensor.closeBmv080();
  pmIsOpen = false;
  pmFresh = 0;
}

void pmReset() {
  hFilled = 0; hSum25 = hSum10 = 0; hN = 0; hourStartMs = 0;
  for (int i = 0; i < NC_HOURS; i++) h25[i] = h10[i] = 0;
}

void pollPM() {
  if (!pmIsOpen) return;
  float pm1Unused, b, c;           // library butuh 3 pointer; PM1 tidak dipakai
  if (pmSensor.getBmv080Data(&pm1Unused, &b, &c)) {
    pm2_5 = b; pm10 = c;
    pmObstructed = pmSensor.ifObstructed();
    if (pmObstructed) pmFresh = 0;
    else if (pmFresh < 1000) pmFresh++;
  }
}

bool pmSettled() { return pmFresh >= PM_SETTLE_READS; }

void pmCollectSecond() {
  if (!pmSettled()) return;
  if (!isnan(pm2_5) && !isnan(pm10) && !pmObstructed) {
    hSum25 += pm2_5;
    hSum10 += pm10;
    hN++;
  }
}

static void pushHour() {
  if (hN <= 0) return;
  for (int i = NC_HOURS - 1; i > 0; i--) {
    h25[i] = h25[i - 1];
    h10[i] = h10[i - 1];
  }
  h25[0] = (float)(hSum25 / hN);
  h10[0] = (float)(hSum10 / hN);
  if (hFilled < NC_HOURS) hFilled++;
  hSum25 = hSum10 = 0;
  hN = 0;
}

void pmHourTick(uint64_t nowMs) {
  if (nowMs - hourStartMs < 3600000ULL) return;
  pushHour();
  hourStartMs = nowMs;
}

// NowCast EPA. Jam berjalan disertakan sebagai indeks 0.
static float nowcastPM(const float* h, int filled, double curSum, int curN) {
  float tmp[NC_HOURS + 1];
  int n = 0;
  if (curN > 0) tmp[n++] = (float)(curSum / curN);
  for (int i = 0; i < filled && n < NC_HOURS; i++) tmp[n++] = h[i];
  if (n == 0) return NAN;

  float cmin = tmp[0], cmax = tmp[0];
  for (int i = 1; i < n; i++) {
    if (tmp[i] < cmin) cmin = tmp[i];
    if (tmp[i] > cmax) cmax = tmp[i];
  }
  if (cmax <= 0) return 0;

  float w = cmin / cmax;
  if (w < 0.5f) w = 0.5f;

  double num = 0, den = 0, wi = 1;
  for (int i = 0; i < n; i++) {
    num += wi * tmp[i];
    den += wi;
    wi *= w;
  }
  return (float)(num / den);
}

float pmNowcast25() { return nowcastPM(h25, hFilled, hSum25, hN); }
float pmNowcast10() { return nowcastPM(h10, hFilled, hSum10, hN); }
