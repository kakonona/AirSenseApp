#pragma once
#include <Arduino.h>

extern float pm2_5, pm10;
extern bool  pmObstructed;
extern int   hFilled;             // jumlah jam terisi (untuk footer)

bool  pmBegin();                  // true jika BMV080 terdeteksi
bool  pmOpen();                   // true jika berhasil dibuka
void  pmConfigure();
void  pollPM();                   // aman dipanggil kapan saja (diabaikan bila sensor belum dibuka)
void  pmCollectSecond();          // masukkan sampel 1 detik ke bucket jam berjalan
void  pmHourTick(uint64_t nowMs); // tutup bucket jam bila sudah >= 1 jam (waktu kontinu)
void  pmReset();                  // boot dingin: kosongkan semua bucket RTC
void  pmShutdown();               // stop + close sebelum deep sleep
float pmNowcast25();
float pmNowcast10();

bool  pmSettled();                // true setelah cukup pembacaan segar sejak (re)start
