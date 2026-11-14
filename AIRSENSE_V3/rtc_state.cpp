#include "rtc_state.h"
#include "config.h"
#include <esp_sleep.h>
#include <driver/rtc_io.h>
#include <sys/time.h>

#define RTC_MAGIC 0xA15E0003u

static RTC_DATA_ATTR uint32_t magic        = 0;
static RTC_DATA_ATTR uint64_t baseMs       = 0;   // waktu terkumpul sebelum boot ini
static RTC_DATA_ATTR int64_t  sleepStartUs = 0;   // gettimeofday saat mulai tidur
static RTC_DATA_ATTR uint32_t sleepReqMs   = 0;   // lama tidur yang diminta (cadangan)

static BootKind kind = BOOT_COLD;

static int64_t nowUs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000000LL + tv.tv_usec;
}

bool rtcInit() {
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  bool valid = (magic == RTC_MAGIC) &&
               (cause == ESP_SLEEP_WAKEUP_TIMER || cause == ESP_SLEEP_WAKEUP_EXT0);

  if (!valid) {                       // power-on, reset, atau upload: mulai dari awal
    magic = RTC_MAGIC;
    baseMs = 0;
    sleepStartUs = 0;
    sleepReqMs = 0;
    kind = BOOT_COLD;
    return false;
  }

  kind = (cause == ESP_SLEEP_WAKEUP_TIMER) ? BOOT_TIMER : BOOT_BUTTON;
  rtc_gpio_deinit((gpio_num_t)WAKE_BTN);  // kembalikan pin tombol ke digital biasa

  // Lama tidur sebenarnya (tombol bisa membangunkan lebih awal). Cadangan: lama yang diminta.
  int64_t elapsedUs = nowUs() - sleepStartUs;
  uint64_t elapsedMs = (elapsedUs > 0 && elapsedUs < 7LL * 24 * 3600 * 1000000LL)
                         ? (uint64_t)(elapsedUs / 1000)
                         : (uint64_t)sleepReqMs;
  baseMs += elapsedMs;
  return true;
}

BootKind bootKind() { return kind; }

const char* bootName(BootKind k) {
  switch (k) {
    case BOOT_TIMER:  return "TIMER";
    case BOOT_BUTTON: return "TOMBOL";
    default:          return "DINGIN";
  }
}

uint64_t uptimeMs() { return baseMs + (uint64_t)millis(); }

void rtcDeepSleep(uint32_t sleepMs) {
  // Wake level-LOW: kalau tombol masih ditekan, ESP langsung bangun lagi. Tunggu dilepas (maks 2 dtk).
  uint32_t t = millis();
  while (digitalRead(WAKE_BTN) == LOW && millis() - t < 2000) delay(10);

  baseMs = uptimeMs();                // simpan waktu terkumpul sampai saat ini
  sleepStartUs = nowUs();
  sleepReqMs = sleepMs;

  esp_sleep_enable_timer_wakeup((uint64_t)sleepMs * 1000ULL);

  rtc_gpio_init((gpio_num_t)WAKE_BTN);
  rtc_gpio_set_direction((gpio_num_t)WAKE_BTN, RTC_GPIO_MODE_INPUT_ONLY);
  rtc_gpio_pullup_en((gpio_num_t)WAKE_BTN);
  rtc_gpio_pulldown_dis((gpio_num_t)WAKE_BTN);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)WAKE_BTN, 0);   // tombol ke GND = bangun
  esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);

  Serial.flush();
  esp_deep_sleep_start();
}
