#pragma once
#include <Arduino.h>

extern int  heartRate;       // bpm, 0 = belum ada nilai valid
extern int  spo2;            // %,   0 = belum ada nilai valid
extern bool fingerPresent;   // true bila jari menempel dan sensor aktif

bool hrBegin();              // false bila MAX30102 tidak terdeteksi (tidak memblokir)
void pollHR();               // panggil sesering mungkin dari loop()
int  hrState();              // 0 = sensor error, 1 = tidak ada jari/standby/tidur, 2 = mengukur
void hrSleep();              // dipanggil saat layar mati
void hrWake();               // dipanggil saat layar menyala

void hrPause();              // tidur siklus: sensor mati total, hasil terakhir dipertahankan
void hrResume();             // awal jendela ukur: sensor aktif, hasil lama dikosongkan