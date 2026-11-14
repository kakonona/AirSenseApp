#pragma once
#include <Arduino.h>

// ====== SIKLUS PENGUKURAN ======
const unsigned long CYCLE_MEASURE_MS = 30UL * 1000UL;    // batas maksimum 1 jendela ukur
const unsigned long CYCLE_SLEEP_MS   = 120UL * 1000UL;   // lama tidur
// true  = jendela baru boleh selesai lebih awal hanya jika HR+SpO2 juga sudah valid
//         (tanpa jari, jendela selalu berjalan penuh 30 detik)
// false = cukup PM dan CO (HR/SpO2 hanya terukur kalau jari sudah menempel)
const bool CYCLE_NEED_VITALS = true;

enum CycleState { CY_WARMUP, CY_MEASURE, CY_SLEEP };

void          cycleBegin();
void          cycleSecond();          // panggil tiap 1 detik, SETELAH data detik itu diproses
CycleState    cycleState();
bool          cycleSensorsOn();       // false saat PM dan HR sedang tidur
const char*   cycleName();            // "WARMUP" / "UKUR" / "TIDUR"
unsigned long cycleRemainingS();      // sisa detik pada fase sekarang (UKUR = batas maksimum)