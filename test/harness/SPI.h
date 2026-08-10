/** Host stub of the SPI library. */
#ifndef PULSE_TEST_SPI_H
#define PULSE_TEST_SPI_H
#include "Arduino.h"
class SPIClass {
public:
  void begin() {}
  void begin(int sck, int miso, int mosi, int ss = -1) { (void)sck; (void)miso; (void)mosi; (void)ss; }
  uint8_t transfer(uint8_t v) { return v; }
};
extern SPIClass SPI;
#endif
