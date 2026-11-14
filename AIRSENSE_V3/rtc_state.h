#pragma once
#include <Arduino.h>

// Status yang bertahan lewat deep sleep (RTC memory) + waktu kontinu.
enum BootKind { BOOT_COLD, BOOT_TIMER, BOOT_BUTTON };

bool        rtcInit();                 // panggil paling awal di setup(); true bila state RTC valid (bukan boot dingin)
BootKind    bootKind();
const char* bootName(BootKind k);
uint64_t    uptimeMs();                // waktu sejak boot dingin, termasuk lama tidur
[[noreturn]] void rtcDeepSleep(uint32_t sleepMs);
