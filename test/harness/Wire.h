/** Host stub of the Wire (I2C) library. */
#ifndef PULSE_TEST_WIRE_H
#define PULSE_TEST_WIRE_H
#include "Arduino.h"
class TwoWire {
public:
  void begin() {}
  void begin(int sda, int scl) { (void)sda; (void)scl; }
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t) {}
  uint8_t endTransmission() { return 0; }
  uint8_t requestFrom(uint8_t, uint8_t) { return 0; }
  int available() { return 0; }
  int read() { return 0; }
  void write(uint8_t) {}
};
extern TwoWire Wire;
#endif
