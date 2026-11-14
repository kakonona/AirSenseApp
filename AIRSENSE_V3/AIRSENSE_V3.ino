#include <Wire.h>
#include "config.h"
#include "rtc_state.h"
#include "display.h"
#include "co_sensor.h"
#include "pm_sensor.h"
#include "aqi.h"
#include "hr_sensor.h"
#include "battery.h"
#include "power.h"
#include "ble.h"
#include "cycle.h"

SET_LOOP_TASK_STACK_SIZE(60 * 1024); // Stack loop task 60KB (jangan dihapus)

static unsigned long lastRead = 0, lastMinute = 0, lastPm = 0;
static bool holdAwake = false;      // serial 'm' = jangan deep sleep (debug); 'q' = lanjutkan
static bool summaryDone = false;
static bool finalFrozen = false;    // snapshot final jendela sudah dibekukan
static bool finalAckLogged = false;
static unsigned long finalAt = 0;   // saat ACK final diterima

// ---------- Helper log ----------
static void stamp(char* b, size_t n) {
  unsigned long s = (unsigned long)(uptimeMs() / 1000ULL);
  snprintf(b, n, "%02lu:%02lu:%02lu", s / 3600UL, (s / 60UL) % 60UL, s % 60UL);
}

static void fnum(char* b, size_t n, float v, int dec) {
  if (isnan(v)) snprintf(b, n, "--");
  else          snprintf(b, n, "%.*f", dec, v);
}

static void inum(char* b, size_t n, int v) {
  if (v <= 0) snprintf(b, n, "--");
  else        snprintf(b, n, "%d", v);
}

// Pesan di layar hanya bila TFT sudah aktif (boot timer tidak menyalakan layar).
static void msg(const char* m, uint16_t col = C_TEXT) {
  if (displayReady()) showMsg(m, col);
}

// Satu baris per detik, kolom lebar tetap.
static void logSecond() {
  char t[12], co[10], rr[8], p25[10], p10[10], a[8], hr[8], ox[8];
  stamp(t, sizeof t);
  fnum(co, sizeof co, curPpm, 1);
  fnum(rr, sizeof rr, curRatio, 2);
  fnum(p25, sizeof p25, pm2_5, 1);
  fnum(p10, sizeof p10, pm10, 1);
  if (aqiMax >= 0) snprintf(a, sizeof a, "%d%s", aqiMax, aqiPartial ? "*" : "");
  else             snprintf(a, sizeof a, "--");
  inum(hr, sizeof hr, heartRate);
  inum(ox, sizeof ox, spo2);

  const char* hs = "";
  if (heartRate <= 0) {
    int st = hrState();
    hs = (st == 0) ? "  [HR ERR]" : (st == 1) ? "  [tempel jari]" : "  [mengukur]";
  }

  char line[260];
  snprintf(line, sizeof line,
           "[%s] %-7s %3lus | CO %5s ppm (Rs/R0 %4s) | PM2.5 %5s  PM10 %5s | AQI %4s %-5s %-13s | BAT %4.2fV %3d%% | HR %3s  SpO2 %3s | BLE %-3s%s%s",
           t, cycleName(), cycleRemainingS(), co, rr, p25, p10, a, domName, labelAQI(aqiMax),
           batV, batPct, hr, ox, bleConnected() ? "ON" : "--",
           hs, pmObstructed ? "  [PM TERTUTUP]" : "");
  Serial.println(line);
}

// Ringkasan: rata-rata CO 8 jam, NowCast PM, sub-indeks AQI. Dicetak tiap menit bangun dan saat jendela selesai.
static void logSummary() {
  char t[12], c8[10], n25[10], n10[10];
  stamp(t, sizeof t);
  fnum(c8, sizeof c8, co8ppm, 2);
  fnum(n25, sizeof n25, ncPm25, 1);
  fnum(n10, sizeof n10, ncPm10, 1);
  Serial.printf("[%s] ---- RINGKAS | CO 8j %s ppm (%d smp) | NowCast PM2.5 %s  PM10 %s (%d/%d jam) | AQI PM2.5 %d  PM10 %d  CO %d => %d %s (%s)%s\n",
                t, c8, count, n25, n10, hFilled, NC_HOURS,
                aqiPm25, aqiPm10, aqiCo, aqiMax, domName, aqiCategory(aqiMax),
                aqiPartial ? " [parsial]" : "");
}

static void scanI2C() {
  Serial.print("[I2C] ditemukan:");
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" 0x%02X", a);
      found++;
    }
  }
  Serial.println(found ? "" : " tidak ada perangkat");
  Serial.printf("[I2C] diharapkan: BMV080 0x%02X, MAX30102 0x57\n", BMV_ADDR);
}

static bool calibrateR0() {
  double s = 0, s2 = 0;
  int n = 0;
  const int bx = 22, by = 150, bw = 196;

  gfx->fillScreen(C_BG);
  drawHeader();
  drawCard(6, 50, 228, 120, C_YELLOW);
  printCentered("KALIBRASI R0", SCR_W / 2, 62, 2, C_YELLOW);
  printCentered("Jaga udara tetap bersih", SCR_W / 2, 92, 1, C_TEXT);
  gfx->fillRect(bx, by, bw, 8, C_TRACK);

  Serial.printf("[CAL] Mulai kalibrasi R0 (%d s). Jaga udara tetap bersih dan stabil.\n", CAL_SECONDS);

  for (int i = 0; i < CAL_SECONDS; i++) {
    float rs = readRs();
    if (!isnan(rs)) { s += rs; s2 += (double)rs * rs; n++; }

    gfx->fillRect(bx, 118, bw, 20, C_CARD);
    printCentered(String(i + 1) + " / " + String(CAL_SECONDS) + " s", SCR_W / 2, 122, 2, C_TEXT);
    gfx->fillRect(bx, by, (bw * (i + 1)) / CAL_SECONDS, 8, C_YELLOW);

    if ((i + 1) % 60 == 0) {
      Serial.printf("[CAL] %3d/%d s | Rs rata-rata %.0f ohm\n", i + 1, CAL_SECONDS, n ? s / n : 0.0);
    }

    for (int k = 0; k < 9; k++) {
      pollPM();
      pollHR();
      delay(100);
    }
  }

  bool ok = false;
  if (n < CAL_SECONDS * 0.9) {
    Serial.printf("[CAL] GAGAL: terlalu banyak pembacaan tidak valid (%d/%d)\n", n, CAL_SECONDS);
  } else {
    double mean = s / n;
    double sd = sqrt(fmax(0.0, s2 / n - mean * mean));
    double cv = sd / mean;
    if (cv > CAL_MAX_CV) {
      Serial.printf("[CAL] DITOLAK: tidak stabil (CV %.1f%% > %.1f%%). R0 lama dipertahankan (%.0f ohm).\n",
                    100.0 * cv, 100.0 * CAL_MAX_CV, R0);
    } else {
      coSetR0((float)mean);
      Serial.printf("[CAL] OK: R0 baru = %.0f ohm (CV %.2f%%), tersimpan.\n", R0, 100.0 * cv);
      ok = true;
    }
  }

  uint16_t rc = ok ? C_GREEN : C_RED;
  drawCard(6, 50, 228, 120, rc);
  printCentered(ok ? "Kalibrasi OK" : "Kalibrasi GAGAL", SCR_W / 2, 100, 2, rc);
  delay(2000);
  return ok;
}

static void enterDeepSleep() {
  logSummary();
  if (!bleFinalAcked()) Serial.println("[BLE] Batas tunggu habis, final belum di-ACK -> disimpan ke backlog");
  bleStashFinal();              // record yang belum diterima app dikirim lagi siklus berikutnya
  Serial.printf("[SLP] Deep sleep %lu s. Tombol (IO%d) membangunkan lebih awal.\n",
                cycleSleepMs() / 1000UL, WAKE_BTN);
  coCommit(uptimeMs(), true);   // simpan rata-rata CO jendela ini ke RTC
  bleStop();
  hrPause();                    // MAX30102 shutdown (LED mati)
  pmShutdown();                 // BMV080 stop + close
  displayPrepareSleep();        // layar mati, pin BL dikunci OFF
  rtcDeepSleep(cycleSleepMs()); // tidak kembali; bangun = setup() lagi
}

void setup() {
  Serial.begin(115200);
  bool warmState = rtcInit();
  BootKind boot = bootKind();
  bool cold = (boot == BOOT_COLD);

  if (cold) {                    // tunggu USB hanya saat boot dingin (hemat daya tiap bangun)
    unsigned long t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(50);
  }
  Serial.println();
  Serial.println("=== AIRSENSE V3 ===");
  Serial.printf("[SYS] Boot: %s | uptime %lu s | state RTC %s\n", bootName(boot),
                (unsigned long)(uptimeMs() / 1000ULL), warmState ? "dipakai" : "baru");

  pinMode(WAKE_BTN, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);
  analogSetPinAttenuation(PIN_BAT, ADC_11db);

  coInit(cold);
  if (cold) pmReset();

  // Boot timer: layar tetap mati (TFT tidak diinisialisasi, BL dijaga OFF). Boot dingin/tombol: layar nyala.
  bool screenOn = (boot != BOOT_TIMER);
  if (screenOn) displayBegin();
  else          backlightForceOff();

  Wire.begin(SDA_PIN, SCL_PIN);
  if (cold) scanI2C();

  msg("Init sensor PM...");
  {
    // Boot dingin: ulangi sampai berhasil. Bangun dari tidur: 3 percobaan, lalu lanjut tanpa PM.
    bool began = false, opened = false;
    for (int i = 0; !opened && (cold || i < 3); i++) {
      if (!began) began = pmBegin();
      if (began) opened = pmOpen();
      if (!opened) {
        Serial.println(began ? "[PM] BMV080 open gagal" : "[PM] BMV080 init gagal, cek koneksi/alamat.");
        msg(began ? "BMV080 gagal dibuka" : "BMV080 tidak ada", C_RED);
        delay(cold ? 1000 : 300);
      }
    }
    if (opened) { pmConfigure(); Serial.println("[PM] BMV080 siap"); }
    else        Serial.println("[PM] BMV080 tidak tersedia pada siklus ini, PM dilewati");
  }

  hrBegin();   // tidak wajib; kalau gagal, kartu HR/SpO2 tampil "SENSOR ERR"

  batUpdate();
  computeAqi();                  // dari data RTC: AQI langsung tersedia setelah bangun

  if (screenOn) {
    gfx->fillScreen(C_BG);
    updateDisplay(true);
  }

  powerInit(screenOn);
  cycleBegin();
  lastRead = lastMinute = millis();

  Serial.printf("[SYS] R0 aktif = %.0f ohm\n", R0);
  if (cold) {
    Serial.printf("[SYS] Pemanasan %lu menit, lalu siklus: ukur maks %lu s, deep sleep %lu s.\n",
                  WARMUP_MS / 60000UL, CYCLE_MEASURE_MS / 1000UL, CYCLE_SLEEP_MS / 1000UL);
    Serial.println("[SYS] Perintah: 'c' kalibrasi R0 (udara bersih, setelah pemanasan), 'm' tahan bangun, 'q' lanjut siklus.");
  }
}

void loop() {
  unsigned long now = millis();

  if (Serial.available()) {
    char ch = Serial.read();
    if (ch == 'm' || ch == 'M') {
      holdAwake = true;
      Serial.println("[SYS] Ditahan bangun (tidak deep sleep). Kirim 'q' untuk lanjut siklus.");
    } else if (ch == 'q' || ch == 'Q') {
      holdAwake = false;
      Serial.println("[SYS] Siklus deep sleep dilanjutkan.");
    } else if (ch == 'c' || ch == 'C') {
      uint64_t up = uptimeMs();
      if (up < WARMUP_MS) {
        Serial.printf("[CAL] Tunggu pemanasan selesai dulu (%lu s lagi).\n",
                      (unsigned long)((WARMUP_MS - up) / 1000ULL));
      } else {
        wakeScreen();            // inisialisasi TFT bila belum
        calibrateR0();
        coReset();
        computeAqi();
        gfx->fillScreen(C_BG);
        updateDisplay(true);
        lastRead = lastMinute = millis();
        powerTouch();
        return;
      }
    }
  }

  pollHR();
  if (now - lastPm >= 100) {
    lastPm = now;
    pollPM();
  }

  if (now - lastRead >= 1000) {
    lastRead = now;

    coSecondTick();
    pmCollectSecond();
    batUpdate();
    uint64_t up = uptimeMs();
    pmHourTick(up);
    coCommit(up, false);
    computeAqi();
    cycleSecond();                // transisi fase dulu, supaya frame di detik penutup sudah bertanda 'final'
    if (cycleWantsSleep() && !finalFrozen) {
      finalFrozen = true;
      bleFreezeFinal();           // hasil jendela dibekukan; dikirim ulang tiap detik sampai app ACK
    }
    bleSend();                    // terkirim hanya bila BLE aktif, terhubung, dan aplikasi sudah subscribe
    logSecond();

    if (cycleWantsSleep() && !summaryDone) { summaryDone = true; logSummary(); }
  }

  if (now - lastMinute >= 60000UL) {
    lastMinute = now;
    computeAqi();
    logSummary();
  }

  bleTick();                      // juga memproses ACK dari aplikasi + kirim backlog
  if (bleFinalAcked() && !finalAckLogged) {
    finalAckLogged = true;
    finalAt = millis();
  }
  handlePower();

  if (!screenIsOff()) updateDisplay();

  // Deep sleep hanya bila: jendela ukur selesai, layar mati, tidak ada alarm, tidak ditahan.
  // Plus: final + semua backlog sudah di-ACK aplikasi (+ jeda flush) ATAU batas tunggu BLE habis.
  bool bleDone = (finalAckLogged && bleBacklogCount() == 0 &&
                  millis() - finalAt >= CYCLE_BLE_FLUSH_MS) || cycleWaitExpired();
  if (!holdAwake && cycleWantsSleep() && bleDone && screenIsOff() && !powerAlert()) {
    enterDeepSleep();
  }

  delay(10);
}
