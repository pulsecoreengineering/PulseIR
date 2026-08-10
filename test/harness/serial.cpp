/**
 * Provides the single global the Arduino shim declares.
 *
 * Kept in its own translation unit so generated sketches can be compiled with
 * a driver main() appended to them without duplicate-symbol clashes.
 */
#include "Arduino.h"

SerialShim Serial;
