/**
 * Provides the single global the Arduino shim declares.
 *
 * Kept in its own translation unit so generated sketches can be compiled with
 * a driver main() appended to them without duplicate-symbol clashes.
 */
#include "Arduino.h"
#include "Wire.h"
#include "SPI.h"
#include "WiFi.h"

SerialShim Serial;
HardwareSerialShim Serial1;
HardwareSerialShim Serial2;
TwoWire Wire;
SPIClass SPI;
WiFiClass WiFi;
