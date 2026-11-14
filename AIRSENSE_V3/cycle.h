#pragma once
#include <Arduino.h>

// ====== SIKLUS PENGUKURAN (deep sleep) ======
// 1 bangun = 1 jendela ukur. Selesai jendela + layar mati + tidak ada alarm -> deep sleep.
const unsigned long CYCLE_MEASURE_MS = 30UL * 1000UL;    // batas maksimum 1 jendela ukur
const unsigned long CYCLE_SLEEP_MS   = 120UL * 1000UL;   // lama deep sleep
// true  = jendela boleh selesai lebih awal hanya jika HR+SpO2 juga sudah valid
//         (tanpa jari, jendela selalu berjalan penuh 30 detik)
// false = cukup PM dan CO
const bool CYCLE_NEED_VITALS = true;
// true  = bila tidak ada jari pada detik ke-CYCLE_NOFINGER_CHECK_MS jendela, langsung deep sleep selama
//         (sisa jendela + CYCLE_SLEEP_MS). Perangkat yang tidak dipakai tidak mengukur apa pun
//         (PM, CO, alarm ikut buta). Hanya berlaku setelah pemanasan.
const bool          CYCLE_SLEEP_IF_NO_FINGER = true;
const unsigned long CYCLE_NOFINGER_CHECK_MS  = 3000UL;   // saat jari dicek
const unsigned long CYCLE_NOFINGER_AWAKE_MS  = 5000UL;   // tanpa jari: batas total bangun (termasuk tunggu BLE)

// Setelah jendela selesai, ESP menunggu frame final terkirim ke aplikasi (terhubung + subscribe).
const unsigned long CYCLE_BLE_WAIT_MS  = 20000UL;  // batas tunggu app reconnect; lewat ini tidur tanpa kirim
const unsigned long CYCLE_BLE_FLUSH_MS = 300UL;    // jeda setelah frame final agar radio selesai mengirim

enum CycleState { CY_WARMUP, CY_MEASURE };

void          cycleBegin();           // panggil di akhir setup()
void          cycleSecond();          // panggil tiap 1 detik, SETELAH data detik itu diproses
CycleState    cycleState();
bool          cycleWantsSleep();      // true bila jendela ukur sudah selesai
bool          cycleWaitExpired();     // true bila batas tunggu BLE habis (jendela sudah selesai)
const char*   cycleName();            // "WARMUP" / "UKUR" / "SELESAI"
uint32_t      cycleSleepMs();         // lama deep sleep yang harus dipakai (lebih panjang bila tanpa jari)
unsigned long cycleRemainingS();      // sisa detik fase sekarang (UKUR = batas maksimum)
