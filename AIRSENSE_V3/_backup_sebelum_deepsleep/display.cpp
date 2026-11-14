#include "display.h"
#include "config.h"
#include "co_sensor.h"
#include "pm_sensor.h"
#include "aqi.h"
#include "hr_sensor.h"
#include "battery.h"

#ifndef ESP_ARDUINO_VERSION_MAJOR
#define ESP_ARDUINO_VERSION_MAJOR 2
#endif

// ST7789 240x280, offset baris 20
static Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, TFT_MISO);
Arduino_GFX *gfx = new Arduino_ST7789(bus, TFT_RESET, 0, true, SCR_W, SCR_H, 0, 20, 0, 20);

// ---- Backlight ----
void setBacklight(uint8_t v) {
#if TFT_BL >= 0
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(TFT_BL, v);
  #else
    ledcWrite(0, v);
  #endif
#endif
}

static void initBacklight() {
#if TFT_BL >= 0
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(TFT_BL, 5000, 8);
  #else
    ledcSetup(0, 5000, 8);
    ledcAttachPin(TFT_BL, 0);
  #endif
#endif
  setBacklight(BRIGHT_FULL);
}

bool displayBegin() {
  bool ok = gfx->begin();
  if (!ok) Serial.println("TFT gagal init, cek pin dan tipe layar");
  gfx->fillScreen(C_BG);
  initBacklight();
  return ok;
}

// ---- Helper teks ----
void printCentered(const String &s, int cx, int y, uint8_t size, uint16_t color) {
  int16_t x1, y1; uint16_t w, h;
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  gfx->setCursor(cx - w / 2 - x1, y);
  gfx->print(s);
}

static void printRight(const String &s, int rx, int y, uint8_t size, uint16_t color) {
  int16_t x1, y1; uint16_t w, h;
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  gfx->setCursor(rx - w - x1, y);
  gfx->print(s);
}

static void printLeft(const String &s, int x, int y, uint8_t size, uint16_t color) {
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  gfx->setCursor(x, y);
  gfx->print(s);
}

// ---- Helper gambar ----
void drawCard(int x, int y, int w, int h, uint16_t accent) {
  gfx->fillRoundRect(x, y, w, h, 10, C_CARD);
  gfx->drawRoundRect(x, y, w, h, 10, accent);
}

static void drawRing(int cx, int cy, int r, int t, float pct, uint16_t col) {
  pct = constrain(pct, 0.0f, 1.0f);
  int lim = (int)(pct * 270);
  for (int a = 0; a <= 270; a += 3) {
    float rad = (135 + a) * DEG_TO_RAD;
    int x = cx + cos(rad) * r;
    int y = cy + sin(rad) * r;
    gfx->fillCircle(x, y, t / 2, (a <= lim) ? col : C_TRACK);
  }
}

static void drawHeartIcon(int x, int y, uint16_t color) {
  gfx->fillCircle(x - 3, y, 4, color);
  gfx->fillCircle(x + 3, y, 4, color);
  gfx->fillTriangle(x - 7, y + 1, x + 7, y + 1, x, y + 9, color);
}

static void drawDropIcon(int x, int y, uint16_t color) {
  gfx->fillTriangle(x, y - 6, x - 5, y + 2, x + 5, y + 2, color);
  gfx->fillCircle(x, y + 3, 5, color);
}

// ---- Warna (tampilan saja, bukan standar medis) ----
static uint16_t colorHR(int v) {
  if (v >= 60 && v <= 100) return C_GREEN;
  if ((v >= 50 && v < 60) || (v > 100 && v <= 120)) return C_YELLOW;
  return C_RED;
}
static uint16_t colorSpO2(int v) {
  if (v >= 95) return C_GREEN;
  if (v >= 90) return C_YELLOW;
  return C_RED;
}
static uint16_t colorBattery(int p) {
  if (p <= 15) return C_RED;
  if (p <= 30) return C_YELLOW;
  return C_GREEN;
}

// ---- Layout (y) ----
static const int Y_HR   = 34;
static const int Y_AQI  = 118;
static const int Y_ROW1 = 182;
static const int Y_ROW2 = 211;
static const int Y_ROW3 = 240;

void drawHeader() {
  for (int x = 0; x < SCR_W; x++) {
    uint8_t r = 14 + (x * 30) / SCR_W;
    uint8_t g = 20 + (x * 2) / SCR_W;
    uint8_t b = 60 + (x * 20) / SCR_W;
    gfx->drawFastVLine(x, 0, 28, gfx->color565(r, g, b));
  }
  gfx->drawFastHLine(0, 28, SCR_W, C_CYAN);

  gfx->fillCircle(16, 14, 4, C_CYAN);
  gfx->fillCircle(16, 14, 2, C_BG);
  printLeft("AIRSENSE", 28, 10, 1, C_TEXT);

  if (pmObstructed) printLeft("PM TERTUTUP", 90, 10, 1, C_RED);

  int bx = 198, by = 8;
  uint16_t col = colorBattery(batPct);
  gfx->drawRoundRect(bx, by, 28, 13, 3, C_TEXT);
  gfx->fillRect(bx + 28, by + 4, 3, 5, C_TEXT);
  int fillW = (24 * constrain(batPct, 0, 100)) / 100;
  if (fillW > 0) gfx->fillRoundRect(bx + 2, by + 2, fillW, 9, 2, col);
  printRight(String(batPct) + "%", bx - 6, 10, 1, col);
}

static void drawVitalLabel(int cx, int y, bool ok, const char* unit) {
  if (ok) { printCentered(unit, cx, y, 1, C_DIM); return; }
  int st = hrState();
  if (st == 0)      printCentered("SENSOR ERR", cx, y, 1, C_RED);
  else if (st == 1) printCentered("TEMPEL JARI", cx, y, 1, C_DIM);
  else              printCentered("MENGUKUR...", cx, y, 1, C_YELLOW);
}

static void drawHR() {
  bool ok = heartRate > 0;
  uint16_t col = ok ? colorHR(heartRate) : C_DIM;
  int x = 6, y = Y_HR, w = 111, h = 80;
  drawCard(x, y, w, h, ok ? col : C_TRACK);
  printLeft("HEART RATE", x + 10, y + 7, 1, C_DIM);
  drawHeartIcon(x + w - 16, y + 11, C_PINK);

  int cx = x + w / 2, cy = y + 52;
  if (ok) drawRing(cx, cy, 28, 6, (heartRate - 40) / 140.0f, col);
  printCentered(ok ? String(heartRate) : String("--"), cx, cy - 12, 3, col);
  drawVitalLabel(cx, cy + 14, ok, "BPM");
}

static void drawSpO2() {
  bool ok = spo2 > 0;
  uint16_t col = ok ? colorSpO2(spo2) : C_DIM;
  int x = 123, y = Y_HR, w = 111, h = 80;
  drawCard(x, y, w, h, ok ? col : C_TRACK);
  printLeft("SpO2", x + 10, y + 7, 1, C_DIM);
  drawDropIcon(x + w - 16, y + 11, C_CYAN);

  int cx = x + w / 2, cy = y + 52;
  if (ok) drawRing(cx, cy, 28, 6, (spo2 - 80) / 20.0f, col);
  printCentered(ok ? String(spo2) : String("--"), cx, cy - 12, 3, col);
  drawVitalLabel(cx, cy + 14, ok, "%");
}

static void drawAQI() {
  int a = aqiMax;
  uint16_t col = aqiColor(a);
  int x = 6, y = Y_AQI, w = 228, h = 60;
  drawCard(x, y, w, h, col);
  printLeft("AIR QUALITY INDEX", x + 12, y + 6, 1, C_DIM);
  if (a >= 0) printRight(String("DOM ") + domName, x + w - 12, y + 6, 1, C_DIM);

  String num = (a < 0) ? String("--") : String(a) + (aqiPartial ? "*" : "");
  printLeft(num, x + 12, y + 17, 3, col);

  const char* lbl = labelAQI(a);
  int16_t x1, y1; uint16_t tw, th;
  gfx->setTextSize(1);
  gfx->getTextBounds(lbl, 0, 0, &x1, &y1, &tw, &th);
  int pw = tw + 16, px = x + w - 12 - pw, py = y + 18;
  gfx->fillRoundRect(px, py, pw, 18, 9, col);
  printCentered(lbl, px + pw / 2, py + 5, 1, (a > 200) ? C_TEXT : C_BG);

  int barX = x + 12, barY = y + 47, barW = w - 24, barH = 5;
  int b[6] = {0, 50, 100, 150, 200, 300};
  uint16_t sc[5] = {C_GREEN, C_YELLOW, C_ORANGE, C_RED, C_PURPLE};
  for (int i = 0; i < 5; i++) {
    int sx = barX + (barW * b[i]) / 300;
    int ex = barX + (barW * b[i + 1]) / 300;
    gfx->fillRect(sx, barY, ex - sx, barH, sc[i]);
  }
  if (a >= 0) {
    int mx = barX + (barW * constrain(a, 0, 300)) / 300;
    gfx->fillTriangle(mx, barY - 1, mx - 4, barY - 6, mx + 4, barY - 6, C_TEXT);
  }
}

static void drawRow(int y, const char* label, float value, const char* unit,
                    int subAqi, uint16_t col, float maxVal,
                    const char* status, uint16_t statusCol) {
  const int x = 10, w = 220, h = 26;
  bool invalid = isnan(value) || value < 0;

  drawCard(x, y, w, h, statusCol == C_RED ? C_RED : C_TRACK);
  gfx->fillRoundRect(x + 4, y + 5, 4, h - 10, 2, col);

  printLeft(label, x + 14, y + 4, 2, C_TEXT);
  if (status[0]) printLeft(status, x + 14 + (int)strlen(label) * 12 + 6, y + 9, 1, statusCol);

  printRight(invalid ? String("--") : String(value, 1), x + 160, y + 4, 2, col);
  printLeft(unit, x + 166, y + 2, 1, C_DIM);

  char b[12];
  if (subAqi < 0) snprintf(b, sizeof b, "AQI --");
  else            snprintf(b, sizeof b, "AQI %d", subAqi);
  printLeft(b, x + 166, y + 11, 1, aqiColor(subAqi));

  int bx = x + 14, bw = w - 28;
  gfx->fillRect(bx, y + 20, bw, 3, C_TRACK);
  int fw = invalid ? 0 : (int)(bw * constrain(value / maxVal, 0.0f, 1.0f));
  if (fw > 0) gfx->fillRect(bx, y + 20, fw, 3, col);
}

static void drawFooter(const String &s) {
  gfx->fillRect(0, 267, SCR_W, 13, C_BG);
  printLeft(s, 8, 270, 1, C_DIM);
}

void showMsg(const char* msg, uint16_t col) {
  gfx->fillScreen(C_BG);
  drawCard(6, 100, 228, 60, col);
  printCentered(msg, SCR_W / 2, 122, 2, col);
}

// ---- Cache (anti flicker) ----
static int  pHR = -2, pSpO2 = -2, pHrState = -1;
static int  pAqi = -9, pAqiPm25 = -9, pAqiPm10 = -9, pAqiCo = -9;
static int  pQ25 = -9, pQ10 = -9, pQCo = -9, pCoStat = -9;
static int  pBat = -9;
static bool pPartial = false, pObs = false;
static const char* pDom = nullptr;
static String pFooter;

static int q10(float v) { return isnan(v) ? -1 : (int)lroundf(v * 10.0f); }

void updateDisplay(bool force) {
  unsigned long now = millis();
  bool warm = now < WARMUP_MS;

  if (force || batPct != pBat || pmObstructed != pObs) {
    drawHeader(); pBat = batPct; pObs = pmObstructed;
  }

  int hs = hrState();
  if (force || heartRate != pHR   || hs != pHrState) { drawHR();   pHR = heartRate; }
  if (force || spo2      != pSpO2 || hs != pHrState) { drawSpO2(); pSpO2 = spo2; }
  pHrState = hs;

  if (force || aqiMax != pAqi || aqiPartial != pPartial || domName != pDom) {
    drawAQI(); pAqi = aqiMax; pPartial = aqiPartial; pDom = domName;
  }

  int q25 = q10(pm2_5);
  if (force || q25 != pQ25 || aqiPm25 != pAqiPm25) {
    drawRow(Y_ROW1, "PM2.5", pm2_5, "ug/m3", aqiPm25,
            concColorPm25(pm2_5), 150.0f, "", C_DIM);
    pQ25 = q25; pAqiPm25 = aqiPm25;
  }

  int qp10 = q10(pm10);
  if (force || qp10 != pQ10 || aqiPm10 != pAqiPm10) {
    drawRow(Y_ROW2, "PM10", pm10, "ug/m3", aqiPm10,
            concColorPm10(pm10), 250.0f, "", C_DIM);
    pQ10 = qp10; pAqiPm10 = aqiPm10;
  }

  // 1000+detik = pemanasan, 1 = error, 2 = ada CO, 0 = normal
  int coStat;
  if (warm)                        coStat = 1000 + (int)((WARMUP_MS - now) / 1000);
  else if (isnan(curRatio))        coStat = 1;
  else if (curRatio < ALERT_RATIO) coStat = 2;
  else                             coStat = 0;

  int qco = q10(curPpm);
  if (force || qco != pQCo || aqiCo != pAqiCo || coStat != pCoStat) {
    char st[16];
    uint16_t stCol;
    if (coStat >= 1000) {
      unsigned long rem = coStat - 1000;
      snprintf(st, sizeof st, "WARM %02lu:%02lu", rem / 60, rem % 60);
      stCol = C_YELLOW;
    } else if (coStat == 1) {
      snprintf(st, sizeof st, "SENSOR ERR");
      stCol = C_RED;
    } else if (coStat == 2) {
      snprintf(st, sizeof st, "ADA CO!");
      stCol = C_RED;
    } else {
      snprintf(st, sizeof st, "NORMAL");
      stCol = C_GREEN;
    }
    uint16_t coCol = warm ? C_DIM : concColorCo(curPpm);
    drawRow(Y_ROW3, "CO", curPpm, "ppm", aqiCo, coCol, 15.0f, st, stCol);
    pQCo = qco; pAqiCo = aqiCo; pCoStat = coStat;
  }

  char fb[48];
  snprintf(fb, sizeof fb, "%sCO %d/%dm | PM %d/%dj",
           aqiPartial ? "*parsial | " : "", count, WINDOW, hFilled, NC_HOURS);
  String f(fb);
  if (force || f != pFooter) { drawFooter(f); pFooter = f; }
}