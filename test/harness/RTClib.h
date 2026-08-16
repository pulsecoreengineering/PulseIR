/** Host stub of the RTClib library — just enough surface to compile. */
#ifndef PULSE_TEST_RTCLIB_H
#define PULSE_TEST_RTCLIB_H
#include <cstdint>
class DateTime {
public:
  uint32_t unixtime() const { return 0; }
};
class RTC_DS3231 {
public:
  bool begin() { return true; }
  DateTime now() { return DateTime{}; }
};
class RTC_DS1307 {
public:
  bool begin() { return true; }
  DateTime now() { return DateTime{}; }
};
#endif
