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
   * Board-level defaults for interface parameters, e.g. i2c_frequency.
   * These are informational; the codegen uses explicit values from the model.
   */
  defaults?: Record<string, string | number>;
}
