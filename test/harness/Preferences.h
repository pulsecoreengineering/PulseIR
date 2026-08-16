/** Host stub of the Arduino Preferences library (ESP32 NVS wrapper). */
#ifndef PULSE_TEST_PREFERENCES_H
#define PULSE_TEST_PREFERENCES_H
#include <cstdint>
#include <cstring>

class Preferences {
public:
  bool begin(const char* /*ns*/, bool /*readOnly*/ = false) { return true; }
  void end() {}

  bool putInt(const char*, int)          { return true; }
  bool putFloat(const char*, float)      { return true; }
  bool putBool(const char*, bool)        { return true; }
  bool putString(const char*, const char*) { return true; }

  int   getInt(const char*, int dflt = 0)       { return dflt; }
  float getFloat(const char*, float dflt = 0.0f) { return dflt; }
  bool  getBool(const char*, bool dflt = false)  { return dflt; }
};
#endif
