#pragma once
#include <Arduino.h>

enum AlertLevel : uint8_t { ALERT_NORMAL = 0, ALERT_WARNING = 1, ALERT_DANGER = 2 };

enum AlertCause : uint8_t {
  AL_SPO2_WARN = 1 << 0,   // SpO2 < 95
  AL_SPO2_CRIT = 1 << 1,   // SpO2 < 90
  AL_HR_LOW    = 1 << 2,   // HR < 60
  AL_HR_HIGH   = 1 << 3,   // HR > 100
  AL_AQI       = 1 << 4,   // AQI > 100
  AL_CO        = 1 << 5    // Rs/R0 < ALERT_RATIO
};

extern AlertLevel alertLevel;
extern uint8_t    alertMask;

void        alertReset();
void        alertUpdate();     // panggil tiap 1 detik
const char* alertText();