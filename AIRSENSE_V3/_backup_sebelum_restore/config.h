#pragma once
#include <Arduino.h>

// ====== PIN ======
#define TFT_SCK    9
#define TFT_MOSI   10
#define TFT_MISO   GFX_NOT_DEFINED
#define TFT_CS     13
#define TFT_DC     12
#define TFT_RESET  11
#define TFT_BL     40
#define WAKE_BTN   8
#define SENSOR_PIN 1
#define PIN_BAT    2
#define SDA_PIN    4
#define SCL_PIN    5

#define SCR_W 240
#define SCR_H 280

// BMV080: CSB=0,MISO=1 -> 0x55 (dipakai). MAX30102 tetap 0x57.
#define BMV_ADDR 0x55

// ====== WARNA ======
#define MK565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
const uint16_t C_BG     = MK565(6, 8, 20);
const uint16_t C_CARD   = MK565(16, 20, 42);
const uint16_t C_TRACK  = MK565(38, 44, 78);
const uint16_t C_TEXT   = MK565(235, 238, 255);
const uint16_t C_DIM    = MK565(150, 160, 200);
const uint16_t C_GREEN  = MK565(0, 230, 118);
const uint16_t C_YELLOW = MK565(255, 214, 0);
const uint16_t C_ORANGE = MK565(255, 145, 0);
const uint16_t C_RED    = MK565(255, 61, 80);
const uint16_t C_PURPLE = MK565(186, 104, 255);
const uint16_t C_MAROON = MK565(160, 20, 40);
const uint16_t C_CYAN   = MK565(0, 229, 255);
const uint16_t C_PINK   = MK565(255, 64, 129);

// ====== Hemat daya layar ======
const bool     SCREEN_SAVER = true;
const uint8_t  BRIGHT_FULL  = 255;
const uint8_t  BRIGHT_DIM   = 40;
const uint32_t DIM_AFTER_MS = 15000;
const uint32_t OFF_AFTER_MS = 45000;

// ====== CO ======
const float         ALERT_RATIO = 0.6;
const unsigned long WARMUP_MS   = 15UL * 60UL * 1000UL;
const int           CAL_SECONDS = 300;
const float         CAL_MAX_CV  = 0.03;
const int           WINDOW      = 480;   // buffer CO 8 jam (per menit)

// ====== PM ======
const int NC_HOURS = 12;