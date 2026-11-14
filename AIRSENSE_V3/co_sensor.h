#pragma once
#include <Arduino.h>

extern float R0;
extern int   count;               // jumlah sampel CO (per ~2,5 mnt) dalam jendela 8 jam
extern float curPpm, curRatio;

void  coInit(bool coldBoot);      // buka Preferences, muat R0; boot dingin = kosongkan ring RTC
void  coSetR0(float r0);          // set + simpan R0 (NVS, bertahan lewat mati total)
float readRs();
void  coSecondTick();             // panggil tiap 1 detik saat bangun
void  coCommit(uint64_t nowMs, bool force);  // simpan rata-rata sejak commit terakhir ke ring RTC
void  coReset();                  // kosongkan ring (setelah kalibrasi)
float avg8h();                    // rata-rata sampel dalam 8 jam terakhir
bool  coAlert();
