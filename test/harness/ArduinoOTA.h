/** Host stub of the ArduinoOTA library — just enough surface to compile. */
#ifndef PULSE_TEST_ARDUINOOTA_H
#define PULSE_TEST_ARDUINOOTA_H
struct _ArduinoOTAClass {
  void setHostname(const char* h) { (void)h; }
  void setPort(int p)             { (void)p; }
  void setPassword(const char* p) { (void)p; }
  void begin()  {}
  void handle() {}
} ArduinoOTA;
#endif
