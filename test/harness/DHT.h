/** Host stub of the Adafruit DHT sensor library — just enough surface to compile. */
#ifndef PULSE_TEST_DHT_H
#define PULSE_TEST_DHT_H
#include "Arduino.h"
#define DHT11 11
#define DHT22 22
class DHT {
public:
  DHT(int pin, int type) : pin_(pin), type_(type) {}
  void begin() {}
  float readTemperature(bool fahrenheit = false) { (void)fahrenheit; return 0.0f; }
  float readHumidity() { return 0.0f; }
private:
  int pin_;
  int type_;
};
#endif
