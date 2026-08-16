/** Host stub of the DallasTemperature library — just enough surface to compile. */
#ifndef PULSE_TEST_DALLASTEMPERATURE_H
#define PULSE_TEST_DALLASTEMPERATURE_H
#include "OneWire.h"
class DallasTemperature {
public:
  explicit DallasTemperature(OneWire*) {}
  void begin() {}
  void requestTemperatures() {}
  float getTempCByIndex(int) { return 0.0f; }
  float getTempFByIndex(int) { return 32.0f; }
};
#endif
