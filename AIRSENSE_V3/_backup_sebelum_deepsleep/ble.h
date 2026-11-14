#pragma once
#include <Arduino.h>

void bleBegin();       // init BLE + mulai advertising
void bleTick();        // panggil tiap loop(): advertising ulang setelah terputus
void bleSend();        // panggil tiap 1 detik: kirim 1 frame bila ada yang terhubung
bool bleConnected();