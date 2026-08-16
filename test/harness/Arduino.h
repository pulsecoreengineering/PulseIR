/**
 * Minimal host-side Arduino shim.
 *
 * This exists so generated sketches can be compiled and linked with a desktop
 * g++ during tests. It is NOT a functional Arduino emulation — it only needs to
 * provide enough surface for generated code (and deps/PulseHSM.cpp) to build.
 */
#ifndef PULSE_TEST_ARDUINO_H
#define PULSE_TEST_ARDUINO_H

#include <cstdint>
#include <cstdio>
#include <string>
#include <ctime>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2

// ISR attribute — empty on host; ESP32 core places ISRs in IRAM.
#ifndef IRAM_ATTR
#define IRAM_ATTR
#endif

// Interrupt mode constants.
#define RISING  1
#define FALLING 2
#define CHANGE  3
#define LOW_LEVEL 4  // LOW is already defined as 0 above

// A virtual clock, so a test can say "twenty seconds pass" without waiting.
// Wall-clock time would make every timed transition a race, and CPU time makes
// the result depend on how fast the machine running the tests happens to be.
extern unsigned long pulseTestClockMs;

inline unsigned long millis() { return pulseTestClockMs; }
inline void delay(unsigned long ms) { pulseTestClockMs += ms; }

/** Move the clock forward. Tests call this instead of sleeping. */
inline void pulseTestAdvance(unsigned long ms) { pulseTestClockMs += ms; }
inline void pinMode(int, int) {}
inline void digitalWrite(int, int) {}
inline int digitalRead(int) { return 0; }
inline void analogWrite(int, int) {}
inline int analogRead(int) { return 0; }
inline int digitalPinToInterrupt(int pin) { return pin; }
inline void attachInterrupt(int, void(*)(), int) {}

class SerialShim {
public:
  void begin(unsigned long) {}
  void print(const char* s) { std::fputs(s, stdout); }
  void print(int v) { std::printf("%d", v); }
  void print(long v) { std::printf("%ld", v); }
  void print(unsigned long v) { std::printf("%lu", v); }
  void print(double v) { std::printf("%g", v); }
  void println() { std::fputc('\n', stdout); }
  void println(const char* s) { std::printf("%s\n", s); }
  void println(int v) { std::printf("%d\n", v); }
  void println(long v) { std::printf("%ld\n", v); }
  void println(unsigned long v) { std::printf("%lu\n", v); }
  void println(double v) { std::printf("%g\n", v); }

  // Incoming bytes. A test feeds the port with feed(); generated command
  // readers consume it exactly as they would consume a serial monitor.
  int available() { return (int)(incoming.size() - readAt); }
  int read() { return readAt < incoming.size() ? (unsigned char)incoming[readAt++] : -1; }
  void feed(const std::string& text) { incoming += text; }

private:
  std::string incoming;
  std::size_t readAt = 0;
};

extern SerialShim Serial;

// Extra UARTs, as declared by `interface: uart` resources.
#define SERIAL_8N1 0x800001c
class HardwareSerialShim {
public:
  void begin(unsigned long) {}
  void begin(unsigned long baud, int config, int rx, int tx) {
    (void)baud; (void)config; (void)rx; (void)tx;
  }
  int available() { return 0; }
  int read() { return -1; }
};
extern HardwareSerialShim Serial1;
extern HardwareSerialShim Serial2;

#endif
