/**
 * Board definition — the mapping layer between logical pin names (LED, I2C_SDA)
 * and the physical GPIO numbers a target platform understands (GPIO2, GPIO21).
 *
 * A board file lives in boards/<id>.yaml and is resolved by the CLI before
 * code generation.  The app model refers to logical names; the board file
 * translates them.  Physical GPIO names (GPIO2, GPIO25…) pass through unchanged
 * so models that already know their hardware still compile without a board file.
 */

export interface BoardDefinition {
  /** Human-readable label, e.g. "ESP32 DevKit V4". */
  name: string;

  /** MCU family identifier, e.g. "esp32", "rp2040", "atmega328p". */
  mcu: string;

  /**
   * Toolchain families this board supports. Validated against the --target
   * flag so the CLI can warn when the combination makes no sense.
   */
  frameworks: string[];

  description?: string;

  /**
   * Logical-to-physical pin map.
   *
   * Keys are symbolic names (LED, I2C_SDA, D13, A0 …).
   * Values are the physical identifiers the codegen already knows (GPIO2, 13 …).
   *
   * Lookup is case-sensitive on both sides; boards should use the canonical
   * case found in the datasheet, and the app model should match exactly.
   */
  pins: Record<string, string>;

  /**
   * Per-pin capability tags, keyed by the physical identifier (GPIO34, …).
   *
   * Tags:
   *   "input_only"  — the pin cannot drive output; wiring an output here is an error.
   *   "reserved"    — the pin is wired internally (SPI flash, PSRAM); any use is an error.
   *   "strapping"   — boot-mode sensitive; driving it LOW at reset may block startup (warning).
   *   "internal"    — connected to an on-board component; use with care (warning).
   */
  pinCaps?: Record<string, string[]>;

  /**
   * Physical GPIO identifiers that belong to ADC unit 2 on this MCU.
   * On the ESP32 family ADC2 is unavailable while Wi-Fi is active.
   * The checker emits a warning when any of these are used as analog_input
   * alongside an MQTT or Wi-Fi bus.
   */
  adc2Pins?: string[];

  /**
   * Board-level defaults for interface parameters, e.g. i2c_frequency.
   * These are informational; the codegen uses explicit values from the model.
   */
  defaults?: Record<string, string | number>;
}
