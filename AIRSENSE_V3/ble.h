#pragma once
#include <Arduino.h>

// ── Protokol BLE v3 (dua arah) ──────────────────────────────────────────────
// ESP -> app (NOTIFY, 20 byte):
//   live     : frame tiap detik selama jendela ukur
//   final    : snapshot hasil jendela (flag bit1), dikirim ulang tiap detik sampai di-ACK
//   backlog  : hasil jendela lama yang belum di-ACK (flag bit2, + umur detik)
// app -> ESP (WRITE, 3 byte): [0xA6, seq lo, seq hi] = record dengan seq tsb sudah diterima
//
// Record final yang tidak di-ACK sampai batas tunggu disimpan ke RTC (backlog) dan
// dikirim lagi saat app terhubung pada siklus berikutnya.

void    bleTick();          // panggil tiap loop(): start BLE, advertising ulang, kirim backlog
bool    bleSend();          // panggil tiap 1 detik: kirim frame live / final
void    bleFreezeFinal();   // panggil SEKALI saat jendela ukur selesai: bekukan snapshot final
bool    bleFinalAcked();    // true bila snapshot final jendela ini sudah di-ACK app
void    bleStashFinal();    // sebelum deep sleep: simpan final yang belum di-ACK ke backlog RTC
uint8_t bleBacklogCount();  // jumlah record backlog yang belum di-ACK
void    bleStop();          // matikan BLE sebelum deep sleep
bool    bleConnected();
bool    bleStarted();
