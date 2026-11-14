#pragma once
#include <Arduino.h>
#include <Arduino_GFX_Library.h>

extern Arduino_GFX *gfx;

bool displayBegin();                       // init TFT + backlight
void setBacklight(uint8_t v);
void printCentered(const String &s, int cx, int y, uint8_t size, uint16_t color);
void drawCard(int x, int y, int w, int h, uint16_t accent);
void drawHeader();
void showMsg(const char* msg, uint16_t col = 0xEF7F);   // default = C_TEXT
void updateDisplay(bool force = false);