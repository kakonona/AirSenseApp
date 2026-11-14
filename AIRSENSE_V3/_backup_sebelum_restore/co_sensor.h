#pragma once
#include <Arduino.h>

extern float R0;
extern int   count;               // jumlah menit terisi di buffer 8 jam
extern float curPpm, curRatio;

void  coInit();                   // buka Preferences, muat R0
void  coSetR0(float r0);          // set + simpan R0
float readRs();
void  coSecondTick();             // panggil tiap 1 detik
void  coMinuteTick(unsigned long now);  // panggil tiap 1 menit
void  coReset();                  // kosongkan buffer (setelah kalibrasi)
float avg8h();