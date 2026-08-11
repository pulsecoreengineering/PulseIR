/** Host stub of the ESP32 WiFi library. */
#ifndef PULSE_TEST_WIFI_H
#define PULSE_TEST_WIFI_H
#include "Arduino.h"
#define WL_CONNECTED 3
class WiFiClient {
public:
  int connected() { return 0; }
};
class WiFiClientSecure : public WiFiClient {
public:
  void setCACert(const char*) {}
  void setInsecure() {}
};
class WiFiClass {
public:
  void begin(const char* ssid, const char* pass) { (void)ssid; (void)pass; }
  void setHostname(const char*) {}
  int status() { return WL_CONNECTED; }
};
extern WiFiClass WiFi;
#endif
