#pragma once
#include <Arduino.h>

extern float ncPm25, ncPm10, co8ppm;
extern int   aqiPm25, aqiPm10, aqiCo, aqiMax;
extern const char* domName;
extern bool  aqiPartial;

void        computeAqi();
const char* aqiCategory(int a);
const char* labelAQI(int a);
uint16_t    aqiColor(int a);

// konversi konsentrasi -> warna (tabel breakpoint sama dengan AQI)
uint16_t concColorPm25(float c);
uint16_t concColorPm10(float c);
uint16_t concColorCo(float c);