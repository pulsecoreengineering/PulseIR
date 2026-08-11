/** Host stub of the OneWire library — just enough surface to compile. */
#ifndef PULSE_TEST_ONEWIRE_H
#define PULSE_TEST_ONEWIRE_H
#include "Arduino.h"
class OneWire {
public:
  explicit OneWire(int pin) : pin_(pin) {}
  bool reset() { return false; }
  void select(const uint8_t*) {}
  void write(uint8_t, uint8_t = 0) {}
  uint8_t read() { return 0; }
private:
  int pin_;
};
#endif
