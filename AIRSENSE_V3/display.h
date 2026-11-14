#pragma once
#include <Arduino.h>
#include <Arduino_GFX_Library.h>

extern Arduino_GFX *gfx;

bool displayBegin();                       // init TFT + backlight
bool displayReady();                       // true bila TFT sudah diinisialisasi pada boot ini
void displayPrepareSleep();                // matikan layar + kunci pin BL OFF selama deep sleep
void backlightForceOff();                  // paksa BL mati tanpa init TFT (boot timer)
void setBacklight(uint8_t v);              // 0 = mati, 255 = terang (polaritas diurus di sini)
void printCentered(const String &s, int cx, int y, uint8_t size, uint16_t color);
void drawCard(int x, int y, int w, int h, uint16_t accent);
void drawHeader();
void showMsg(const char* msg, uint16_t col = 0xEF7F);   // default = C_TEXT
void updateDisplay(bool force = false);
