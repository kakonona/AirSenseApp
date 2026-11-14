#include "aqi.h"
#include "config.h"
#include "pm_sensor.h"
#include "co_sensor.h"

struct Bp { int cLo, cHi, iLo, iHi; };

// Breakpoint dalam persepuluhan (x10). Sumber: EPA TAD AQI. Verifikasi sebelum disitasi.
static const Bp BP_PM25[] = {
  {0,    90,   0,   50},
  {91,   354,  51,  100},
  {355,  554,  101, 150},
  {555,  1254, 151, 200},
  {1255, 2254, 201, 300},
  {2255, 3254, 301, 500}
};
static const Bp BP_PM10[] = {
  {0,    540,  0,   50},
  {550,  1540, 51,  100},
  {1550, 2540, 101, 150},
  {2550, 3540, 151, 200},
  {3550, 4240, 201, 300},
  {4250, 5040, 301, 400},
  {5050, 6040, 401, 500}
};
static const Bp BP_CO[] = {
  {0,   44,  0,   50},
  {45,  94,  51,  100},
  {95,  124, 101, 150},
  {125, 154, 151, 200},
  {155, 304, 201, 300},
  {305, 404, 301, 400},
  {405, 504, 401, 500}
};
static const int N_PM25 = sizeof(BP_PM25) / sizeof(BP_PM25[0]);
static const int N_PM10 = sizeof(BP_PM10) / sizeof(BP_PM10[0]);
static const int N_CO   = sizeof(BP_CO)   / sizeof(BP_CO[0]);

float ncPm25 = NAN, ncPm10 = NAN, co8ppm = NAN;
int   aqiPm25 = -1, aqiPm10 = -1, aqiCo = -1, aqiMax = -1;
const char* domName = "-";
bool  aqiPartial = true;

static int toTenths(float c) {
  if (isnan(c) || c < 0) return -1;
  return (int)floorf(c * 10.0f + 0.001f);
}
static int toWhole10(float c) {
  if (isnan(c) || c < 0) return -1;
  return (int)floorf(c + 0.001f) * 10;
}

static int calcAqi(int c10, const Bp* t, int n) {
  if (c10 < 0) return -1;
  if (c10 > t[n - 1].cHi) return 500;
  for (int i = 0; i < n; i++) {
    if (c10 <= t[i].cHi) {
      float I = (float)(t[i].iHi - t[i].iLo) * (c10 - t[i].cLo) /
                (float)(t[i].cHi - t[i].cLo) + t[i].iLo;
      return (int)roundf(I);
    }
  }
  return 500;
}

const char* aqiCategory(int a) {
  if (a < 0)    return "-";
  if (a <= 50)  return "Good";
  if (a <= 100) return "Moderate";
  if (a <= 150) return "Unhealthy for Sensitive Groups";
  if (a <= 200) return "Unhealthy";
  if (a <= 300) return "Very Unhealthy";
  return "Hazardous";
}

const char* labelAQI(int a) {
  if (a < 0)    return "MENUNGGU";
  if (a <= 50)  return "BAIK";
  if (a <= 100) return "SEDANG";
  if (a <= 150) return "SENSITIF";
  if (a <= 200) return "TIDAK SEHAT";
  if (a <= 300) return "SGT TDK SEHAT";
  return "BERBAHAYA";
}

uint16_t aqiColor(int a) {
  if (a < 0)    return C_DIM;
  if (a <= 50)  return C_GREEN;
  if (a <= 100) return C_YELLOW;
  if (a <= 150) return C_ORANGE;
  if (a <= 200) return C_RED;
  if (a <= 300) return C_PURPLE;
  return C_MAROON;
}

uint16_t concColorPm25(float c) { return aqiColor(calcAqi(toTenths(c),  BP_PM25, N_PM25)); }
uint16_t concColorPm10(float c) { return aqiColor(calcAqi(toWhole10(c), BP_PM10, N_PM10)); }
uint16_t concColorCo(float c)   { return aqiColor(calcAqi(toTenths(c),  BP_CO,   N_CO)); }

void computeAqi() {
  ncPm25 = pmNowcast25();
  ncPm10 = pmNowcast10();
  co8ppm = avg8h();

  aqiPm25 = calcAqi(toTenths(ncPm25),  BP_PM25, N_PM25);
  aqiPm10 = calcAqi(toWhole10(ncPm10), BP_PM10, N_PM10);
  aqiCo   = calcAqi(toTenths(co8ppm),  BP_CO,   N_CO);

  aqiMax = -1;
  domName = "-";
  int nValid = 0;
  if (aqiPm25 >= 0) { nValid++; if (aqiPm25 > aqiMax) { aqiMax = aqiPm25; domName = "PM2.5"; } }
  if (aqiPm10 >= 0) { nValid++; if (aqiPm10 > aqiMax) { aqiMax = aqiPm10; domName = "PM10"; } }
  if (aqiCo   >= 0) { nValid++; if (aqiCo   > aqiMax) { aqiMax = aqiCo;   domName = "CO"; } }
  aqiPartial = (nValid < 3);
}