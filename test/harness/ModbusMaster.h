/**
 * Host stub of ModbusMaster.
 *
 * A declared library only has to exist for the generated `#include` to compile;
 * the generated code never calls into it, because talking to a field device is
 * driver work and lives in your own actions.
 */
#ifndef PULSE_TEST_MODBUSMASTER_H
#define PULSE_TEST_MODBUSMASTER_H
#include "Arduino.h"

class ModbusMaster {
public:
  // The real signature takes a Stream&; the shim takes anything, so it does
  // not need a Stream hierarchy that nothing here uses.
  template <typename Port>
  void begin(uint8_t slave, Port& port) { (void)slave; (void)port; }
  uint8_t readInputRegisters(uint16_t addr, uint16_t count) { (void)addr; (void)count; return 0; }
  uint16_t getResponseBuffer(uint8_t index) { (void)index; return 0; }
};

#endif
