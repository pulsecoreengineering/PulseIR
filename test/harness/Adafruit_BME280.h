/** Host stub of Adafruit_BME280, declared by the greenhouse model. */
#ifndef PULSE_TEST_BME280_H
#define PULSE_TEST_BME280_H
#include "Arduino.h"
#include "Wire.h"
class Adafruit_BME280 {
public:
  bool begin(uint8_t addr = 0x76) { (void)addr; return false; }
  float readTemperature() { return 0.0f; }
  float readHumidity() { return 0.0f; }
  float readPressure() { return 0.0f; }
};
#endif
