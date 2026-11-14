#include "power.h"
#include <Arduino.h>
#include "config.h"
#include "display.h"
#include "hr_sensor.h"
#include "aqi.h"
#include "co_sensor.h"

enum ScreenState { SCR_ON, SCR_DIM, SCR_OFF };
static ScreenState screenState = SCR_ON;
static uint32_t lastActivity = 0;
static bool prevAlert = false;

void powerInit()   { lastActivity = millis(); }
void powerTouch()  { lastActivity = millis(); }
bool screenIsOff() { return screenState == SCR_OFF; }

// HR/SpO2 sengaja tidak ikut: layar sudah dijaga menyala selama jari menempel.
static bool isAlert() {
  return aqiMax > 150 || coAlert();
}

void wakeScreen() {
  lastActivity = millis();
  if (screenState == SCR_ON) return;

  if (screenState == SCR_OFF) {
    gfx->displayOn();
    delay(120);
    hrWake();
    updateDisplay(true);
  }
  setBacklight(BRIGHT_FULL);
  screenState = SCR_ON;
}

void handlePower() {
  uint32_t now = millis();

  static bool lastBtn = HIGH;
  bool btn = digitalRead(WAKE_BTN);
  if (lastBtn == HIGH && btn == LOW) wakeScreen();
  lastBtn = btn;

  static bool prevFinger = false;
  if (fingerPresent && !prevFinger) wakeScreen();
  prevFinger = fingerPresent;
  if (fingerPresent) lastActivity = now;

  bool alert = isAlert();
  if (alert && !prevAlert) wakeScreen();
  prevAlert = alert;
  if (alert) lastActivity = now;

  if (!SCREEN_SAVER) return;

  uint32_t idle = now - lastActivity;
  if (screenState == SCR_ON && idle >= DIM_AFTER_MS) {
    setBacklight(BRIGHT_DIM);
    screenState = SCR_DIM;
  }
  if (screenState == SCR_DIM && idle >= OFF_AFTER_MS) {
    setBacklight(0);
    gfx->displayOff();
    hrSleep();
    screenState = SCR_OFF;
  }
}