#pragma once

void powerInit(bool screenOn = true);   // false = boot timer, layar belum diinisialisasi
void powerTouch();      // reset timer aktivitas
void wakeScreen();      // init TFT bila belum, lalu nyalakan
void handlePower();
bool screenIsOff();
bool powerAlert();      // true bila ada alarm (AQI > 150 atau CO): jangan deep sleep
