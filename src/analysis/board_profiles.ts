/**
 * Board capability profiles and profile-based pin checks.
 *
 * The profile for each supported board is compiled into the source from
 * vendor documentation. Each entry names its citation so the data can be
 * traced back to a primary source and re-verified against updated datasheets.
 *
 * Checks covered:
 *   - Flash-reserved pins: wired to the integrated SPI flash controller;
 *     application code must not touch them.
 *   - Input-only pins: no output driver; using them to drive anything is a
 *     hard error caught before code generation.
 *   - ADC2 + Wi-Fi conflict: ESP32's ADC2 peripheral is borrowed by the
 *     Wi-Fi driver; an analog_input on an ADC2 pin will silently return
 *     garbage once Wi-Fi starts.
 */

import type { PulseProject } from '../model/index.js';
import { normalizePin } from './pins.js';

// ============================================================================
// Interfaces
// ============================================================================

export interface BoardProfile {
  board: string;
  /** Primary source for every number in this record. */
  citation: string;
  /** Normalised GPIO numbers that are input-only: no output driver exists. */
  inputOnly: string[];
  /** Normalised GPIO numbers wired to the integrated SPI flash controller. */
  flashReserved: string[];
  /**
   * Normalised GPIO numbers on ADC2, which is disabled by the Wi-Fi driver.
   * Only an `analog_input` device on one of these pins is flagged — digital
   * I/O on ADC2 pins is unaffected by Wi-Fi.
   */
  adc2: string[];
}

export interface BoardViolation {
  severity: 'error' | 'warning';
  message: string;
}

// ============================================================================
// Profile data
// ============================================================================

/**
 * ESP32 (Xtensa LX6 dual-core, WROOM-32 / WROVER module family).
 *
 * Sources verified against:
 *   Espressif ESP32 Datasheet v4.5 (DS_ESP32_EN):
 *     §4.1 "SPI Flash and SRAM" — GPIO6–GPIO11 are used by the integrated
 *       SPI flash controller and must not be driven by application code.
 *     §4.2 "IO_MUX and GPIO Matrix" — GPIO34–GPIO39 are input-only; they
 *       have no output driver and no internal pull-up or pull-down.
 *   Espressif ESP32 Technical Reference Manual v5.2 (esp32_technical_reference_manual_en):
 *     §29.2 "ADC Features" — "ADC2 is used by the Wi-Fi driver. Therefore
 *       the application can only use ADC2 when the Wi-Fi driver has not started."
 *     §29.3 "ADC Channel to GPIO Pin Mapping" — ADC2 channels:
 *       CH0=GPIO4, CH1=GPIO0, CH2=GPIO2, CH3=GPIO15, CH4=GPIO13, CH5=GPIO12,
 *       CH6=GPIO14, CH7=GPIO27, CH8=GPIO25, CH9=GPIO26.
 */
const ESP32: BoardProfile = {
  board:         'esp32',
  citation:
    'Espressif ESP32 Datasheet v4.5 §4.1 (flash-reserved), §4.2 (input-only); ' +
    'ESP32 TRM v5.2 §29.2–29.3 (ADC2/Wi-Fi)',
  inputOnly:     ['34', '35', '36', '39'],
  flashReserved: ['6', '7', '8', '9', '10', '11'],
  adc2:          ['0', '2', '4', '12', '13', '14', '15', '25', '26', '27'],
};

const PROFILES: BoardProfile[] = [ESP32];

// ============================================================================
// Profile lookup
// ============================================================================

/**
 * Return the profile for `board`, or null when none is registered.
 *
 * Matching is case-insensitive and prefix-based so that "esp32s2", "esp32c3"
 * etc. do NOT accidentally inherit the ESP32 classic profile — only the exact
 * string "esp32" matches.
 */
export function loadProfile(board: string): BoardProfile | null {
  const key = board.trim().toLowerCase();
  return PROFILES.find(p => key === p.board) ?? null;
}

// ============================================================================
// Capability checks
// ============================================================================

/**
 * Binding roles that require the underlying GPIO to be output-capable, keyed
 * by interface type. Roles not listed here are treated as input or ambiguous
 * and are not flagged on input-only pins.
 */
const OUTPUT_ROLES_BY_IFACE: Readonly<Record<string, readonly string[]>> = {
  i2c:     ['sda', 'scl'],   // open-drain but the pin must drive the bus
  spi:     ['mosi', 'sck', 'cs'],
  uart:    ['tx'],
  pwm:     ['pin'],
  onewire: ['pin'],           // bidirectional; the driver toggles direction
  can:     ['tx'],
};

/** Device types whose `pin` must be output-capable. */
const OUTPUT_DEVICE_TYPES = new Set(['digital_output', 'pwm_output']);

/**
 * Run all profile-based checks against a parsed project.
 *
 * Errors must not reach code generation; warnings are surfaced but do not
 * block the build. The caller decides how to route each severity.
 */
export function checkBoardProfile(
  project: PulseProject,
  profile: BoardProfile,
): BoardViolation[] {
  const violations: BoardViolation[] = [];

  const flashSet    = new Set(profile.flashReserved);
  const inputOnlySet = new Set(profile.inputOnly);
  const adc2Set     = new Set(profile.adc2);

  const hasWifi = (project.system.resources ?? []).some(
    r => String(r.interface) === 'wifi',
  );

  // --------------------------------------------------------------------------
  // Buses (resources): check every declared binding key
  // --------------------------------------------------------------------------
  for (const resource of project.system.resources ?? []) {
    const binding = resource.binding ?? {};
    const iface   = String(resource.interface);
    const outputRoles = new Set<string>(OUTPUT_ROLES_BY_IFACE[iface] ?? []);

    for (const [role, rawPin] of Object.entries(binding)) {
      const pin = normalizePin(rawPin);
      if (pin === null) continue;

      if (flashSet.has(pin)) {
        violations.push({
          severity: 'error',
          message:
            `${resource.name}.${role} = GPIO${pin}: ` +
            `GPIO${pin} is connected to the integrated SPI flash on ESP32 and ` +
            `cannot be used by application code (${profile.citation})`,
        });
        continue;
      }

      if (inputOnlySet.has(pin) && outputRoles.has(role)) {
        violations.push({
          severity: 'error',
          message:
            `${resource.name}.${role} = GPIO${pin}: ` +
            `GPIO${pin} is input-only on ESP32 — it has no output driver and ` +
            `cannot be used for ${iface} ${role} (${profile.citation})`,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Devices (components): check the device's own `pin` key
  // Bus-attached devices are skipped — their electrical path goes through the bus.
  // --------------------------------------------------------------------------
  for (const device of project.system.components ?? []) {
    if (device.bus) continue;

    const config  = device.config ?? {};
    const devType = (device.type ?? '').toLowerCase();
    const rawPin  = config['pin'];
    if (rawPin === undefined) continue;

    const pin = normalizePin(rawPin);
    if (pin === null) continue;

    if (flashSet.has(pin)) {
      violations.push({
        severity: 'error',
        message:
          `${device.name}.pin = GPIO${pin}: ` +
          `GPIO${pin} is connected to the integrated SPI flash on ESP32 and ` +
          `cannot be used by application code (${profile.citation})`,
      });
      continue;
    }

    if (inputOnlySet.has(pin) && OUTPUT_DEVICE_TYPES.has(devType)) {
      violations.push({
        severity: 'error',
        message:
          `${device.name} (${devType}) is wired to GPIO${pin}, ` +
          `which is input-only on ESP32 — it has no output driver ` +
          `(${profile.citation})`,
      });
      continue;
    }

    if (hasWifi && adc2Set.has(pin) && devType === 'analog_input') {
      violations.push({
        severity: 'warning',
        message:
          `${device.name} uses GPIO${pin} (ADC2) while Wi-Fi is declared. ` +
          `ADC2 is disabled by the Wi-Fi driver on ESP32; analog reads on ` +
          `this pin will fail at runtime. ` +
          `Use an ADC1 pin (GPIO32–GPIO39) instead (${profile.citation})`,
      });
    }
  }

  return violations;
}
