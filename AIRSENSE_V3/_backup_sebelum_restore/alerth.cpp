#include "alert.h"
#include "config.h"
#include "aqi.h"
#include "hr_sensor.h"
#include "co_sensor.h"

AlertLevel alertLevel = ALERT_NORMAL;
uint8_t    alertMask  = 0;

struct Latch { bool on; bool armed; uint32_t since; };
static Latch    L[6];

// Aktif setelah 'trigger' bertahan >= ALERT_CONFIRM_MS; padam saat 'release'.
static bool confirm(Latch& l, bool trigger, bool release, uint32_t now) {
  if (l.on) {
    if (release) { l.on = false; l.armed = false; }
    return l.on;
  }
  if (!trigger) { l.armed = false; return false; }
  if (!l.armed) { l.armed = true; l.since = now; }
  if (now - l.since >= ALERT_CONFIRM_MS) l.on = true;
  return l.on;
}

void alertReset() {
  memset(L, 0, sizeof(L));
  alertMask  = 0;
  alertLevel = ALERT_NORMAL;
}

void alertUpdate() {
  uint32_t now = millis();
  bool s = spo2 > 0;
  bool h = heartRate > 0;
  bool co = coAlert();
  uint8_t m = 0;

  if (confirm(L[0], s && spo2 < ALERT_SPO2_WARN,
                    !s || spo2 >= ALERT_SPO2_WARN + ALERT_HYST_SPO2, now)) m |= AL_SPO2_WARN;
  if (confirm(L[1], s && spo2 < ALERT_SPO2_CRIT,
                    !s || spo2 >= ALERT_SPO2_CRIT + ALERT_HYST_SPO2, now)) m |= AL_SPO2_CRIT;
  if (confirm(L[2], h && heartRate < ALERT_HR_LOW,
                    !h || heartRate >= ALERT_HR_LOW + ALERT_HYST_HR, now)) m |= AL_HR_LOW;
  if (confirm(L[3], h && heartRate > ALERT_HR_HIGH,
                    !h || heartRate <= ALERT_HR_HIGH - ALERT_HYST_HR, now)) m |= AL_HR_HIGH;
  if (confirm(L[4], aqiMax > ALERT_AQI,
                    aqiMax <= ALERT_AQI - ALERT_HYST_AQI, now)) m |= AL_AQI;
  if (confirm(L[5], co, !co, now)) m |= AL_CO;

  AlertLevel lv = ALERT_NORMAL;
  if (m)                  lv = ALERT_WARNING;
  if (m & AL_SPO2_CRIT)   lv = ALERT_DANGER;

  if (m != alertMask) {
    Serial.printf("ALERT level=%u mask=0x%02X\n", (unsigned)lv, (unsigned)m);
  }
  alertMask  = m;
  alertLevel = lv;
}

const char* alertText() {
  if (alertLevel == ALERT_DANGER)  return "BAHAYA";
  if (alertLevel == ALERT_WARNING) return "WASPADA";
  return "";
}