#pragma once
#include <Arduino.h>

extern float pm2_5, pm10;
extern bool  pmObstructed;
extern int   hFilled;             // jumlah jam terisi (untuk footer)

bool  pmBegin();                  // true jika BMV080 terdeteksi
bool  pmOpen();                   // true jika berhasil dibuka
void  pmConfigure();
void  pollPM();
void  pmCollectSecond();          // masukkan sampel 1 detik ke bucket jam berjalan
void  pmPushHour();               // tutup bucket jam
float pmNowcast25();
float pmNowcast10();

bool  pmSettled();                // true setelah cukup pembacaan segar sejak (re)start
void  pmSleep();                  // hentikan pengukuran (idle)
bool  pmResume();                 // lanjutkan mode kontinu; true jika berhasil