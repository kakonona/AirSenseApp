#include "battery.h"
#include "config.h"

#define DIVIDER_RATIO 2.0f
#define NUM_SAMPLES   16
static const float vTable[] = {3.00, 3.30, 3.50, 3.60, 3.70, 3.75, 3.80, 3.90, 4.00, 4.10, 4.20};
static const int   pTable[] = {0,    5,    10,   20,   35,   50,   60,   75,   88,   95,   100};
static const int   TABLE_SIZE = sizeof(vTable) / sizeof(vTable[0]);

float batV = NAN;
int   batPct = -1;

static float readBatteryVoltage() {
  uint32_t s = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    s += analogReadMilliVolts(PIN_BAT);
    delay(2);
  }
  return (s / (float)NUM_SAMPLES * DIVIDER_RATIO) / 1000.0f;
}

static int batteryPercent(float v) {
  if (v <= vTable[0]) return 0;
  if (v >= vTable[TABLE_SIZE - 1]) return 100;
  for (int i = 0; i < TABLE_SIZE - 1; i++) {
    if (v <= vTable[i + 1]) {
      float r = (v - vTable[i]) / (vTable[i + 1] - vTable[i]);
      return pTable[i] + r * (pTable[i + 1] - pTable[i]);
    }
  }
  return 100;
}

void batUpdate() {
  batV = readBatteryVoltage();
  batPct = batteryPercent(batV);
}