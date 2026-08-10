/** Host stub of PubSubClient. */
#ifndef PULSE_TEST_PUBSUBCLIENT_H
#define PULSE_TEST_PUBSUBCLIENT_H
#include "Arduino.h"
#include "WiFi.h"
class PubSubClient {
public:
  explicit PubSubClient(WiFiClient& c) : client_(c) {}
  PubSubClient& setServer(const char* host, uint16_t port) { (void)host; (void)port; return *this; }
  bool connected() { return false; }
  bool connect(const char*) { return false; }
  bool publish(const char*, const char*) { return false; }
  bool subscribe(const char*) { return false; }
  bool loop() { return false; }
private:
  WiFiClient& client_;
};
#endif
