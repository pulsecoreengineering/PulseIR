/**
 * Arduino interface backend.
 *
 * The IR says *what* is wired up ("an I2C bus on pins 21 and 22"); this module
 * knows what that means for the Arduino platform (`Wire.begin(21, 22)`). That
 * split is deliberate: an ESP-IDF backend would translate the same resource
 * into `i2c_param_config()` without the model changing at all.
 *
 * Nothing here is peripheral *logic* - no register writes, no protocol
 * sequences. Those belong in the user's driver code, exactly as guard and
 * action bodies do.
 *
 * Portability note: pin-taking `begin()` overloads exist on ESP32, ESP8266 and
 * RP2040 cores but not on AVR, so board-specific calls are wrapped in
 * preprocessor guards rather than assumed.
 */

import type { Resource, Library } from '../model/index.js';

/** A library the platform provides, implied by using an interface. */
export interface ImpliedLibrary {
  name: string;
  include: string;
  source: 'builtin' | 'registry';
  reason: string;
}

export interface InterfaceEmission {
  /** `#define` lines for this resource's bindings. */
  defines: string[];
  /** File-scope declarations (client objects and the like). */
  globals: string[];
  /** Statements to run inside setupInterfaces(). */
  init: string[];
  /** Libraries this interface needs. */
  libraries: ImpliedLibrary[];
  /** Anything the user must finish themselves. */
  todos: string[];
}

/**
 * Binding keys whose values must never be baked into generated source. A model
 * lives in version control; a Wi-Fi password should not.
 */
const SECRET_KEY = /(pass|password|secret|token|psk|credential|apikey|api_key)/i;

/**
 * An environment-variable reference: `${WIFI_SSID}`.
 *
 * When a binding value matches this pattern the generated code emits a
 * `#ifndef` / `#define` guard that falls back to an empty string, so the
 * sketch compiles out of the box while still making clear where the real
 * value must come from (a build flag, e.g. `-DWIFI_SSID=\"your_network\"`).
 * The resource's own `#define` then aliases that symbol so every call site
 * remains unchanged.
 */
const ENV_VAR_REF = /^\$\{([A-Z_][A-Z0-9_]*)\}$/i;

const BUILTIN = (name: string, include: string, reason: string): ImpliedLibrary =>
  ({ name, include, source: 'builtin', reason });

const REGISTRY = (name: string, include: string, reason: string): ImpliedLibrary =>
  ({ name, include, source: 'registry', reason });

/**
 * Keys the backend reads to decide *how* to emit, rather than values to emit.
 * Defining them would produce meaningless macros like `#define X_MODE pwm`.
 */
const CONSUMED_KEYS: Record<string, string[]> = {
  gpio: ['mode'],
  uart: ['port'],
  mqtt: ['tls'],
};

/** Binding keys each interface understands; anything else is documented only. */
const KNOWN_KEYS: Record<string, string[]> = {
  gpio: ['pin', 'pins', 'mode'],
  pwm: ['pin', 'channel', 'frequency', 'resolution'],
  adc: ['pin', 'attenuation', 'resolution'],
  uart: ['port', 'baud', 'rx', 'tx'],
  i2c: ['sda', 'scl', 'frequency', 'address'],
  spi: ['sck', 'miso', 'mosi', 'cs', 'frequency'],
  can: ['tx', 'rx', 'bitrate'],
  onewire: ['pin'],
  wifi: ['ssid', 'password', 'hostname'],
  ethernet: ['cs', 'mac'],
  ble: ['name', 'service'],
  mqtt: ['host', 'port', 'prefix', 'tls', 'username', 'password', 'client_id'],
  custom: [],
};

export class InterfaceBackend {
  /** Emit everything a single resource contributes to the sketch. */
  emit(resource: Resource, symbol: string): InterfaceEmission {
    const binding = resource.binding || {};
    const kind = String(resource.interface);

    const out: InterfaceEmission = {
      defines: this.defines(kind, binding, symbol),
      globals: [],
      init: [],
      libraries: [],
      todos: [],
    };

    const has = (key: string): boolean =>
      binding[key] !== undefined && !SECRET_KEY.test(key);
    const ref = (key: string): string => `${symbol}_${key.toUpperCase()}`;

    switch (kind) {
      case 'i2c':
        out.libraries.push(BUILTIN('Wire', 'Wire.h', 'I2C'));
        out.init.push(
          ...guarded(
            has('sda') && has('scl')
              ? `Wire.begin(${ref('sda')}, ${ref('scl')});`
              : 'Wire.begin();',
            'Wire.begin();'
          )
        );
        if (has('frequency')) out.init.push(`Wire.setClock(${ref('frequency')});`);
        break;

      case 'spi':
        out.libraries.push(BUILTIN('SPI', 'SPI.h', 'SPI'));
        out.init.push(
          ...guarded(
            has('sck') && has('miso') && has('mosi')
              ? `SPI.begin(${ref('sck')}, ${ref('miso')}, ${ref('mosi')}${has('cs') ? `, ${ref('cs')}` : ''});`
              : 'SPI.begin();',
            'SPI.begin();'
          )
        );
        if (has('cs')) out.init.push(`pinMode(${ref('cs')}, OUTPUT);`);
        break;

      case 'uart': {
        const port = binding.port === undefined ? 1 : Number(binding.port);
        const serial = port === 0 ? 'Serial' : `Serial${port}`;
        const baud = has('baud') ? ref('baud') : '115200';
        out.init.push(
          ...guarded(
            has('rx') && has('tx')
              ? `${serial}.begin(${baud}, SERIAL_8N1, ${ref('rx')}, ${ref('tx')});`
              : `${serial}.begin(${baud});`,
            `${serial}.begin(${baud});`
          )
        );
        break;
      }

      case 'pwm': {
        // ledc is ESP32-only; elsewhere analogWrite needs no setup.
        //
        // Core 3.x replaced the channel-addressed LEDC API (ledcSetup +
        // ledcAttachPin, then ledcWrite(channel, duty)) with a pin-addressed
        // one (ledcAttach, then ledcWrite(pin, duty)) and dropped the old
        // functions outright - so a model built against one core fails to
        // compile on the other unless both paths are emitted. Gated on
        // ESP_ARDUINO_VERSION_MAJOR, which esp32-hal-version.h has defined
        // since core 2.0.1; cores too old to define it only ever had the
        // channel-addressed API, so the #else is also their only path.
        if (has('pin') && has('channel')) {
          const freq = has('frequency') ? ref('frequency') : '5000';
          const resolution = has('resolution') ? ref('resolution') : '8';
          out.init.push(
            '#ifdef ARDUINO_ARCH_ESP32',
            '#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3',
            `  ledcAttach(${ref('pin')}, ${freq}, ${resolution});`,
            '#else',
            `  ledcSetup(${ref('channel')}, ${freq}, ${resolution});`,
            `  ledcAttachPin(${ref('pin')}, ${ref('channel')});`,
            '#endif',
            '#endif'
          );
          out.todos.push(
            `${resource.name}: write duty with ledcWrite(${ref('pin')}, duty) on core 3.x, ` +
            `or ledcWrite(${ref('channel')}, duty) before it`
          );
        } else if (has('pin')) {
          out.init.push(`pinMode(${ref('pin')}, OUTPUT);`);
        }
        break;
      }

      case 'adc':
        if (has('pin')) out.init.push(`pinMode(${ref('pin')}, INPUT);`);
        break;

      case 'gpio':
        if (has('pin')) {
          const mode = String(binding.mode || 'OUTPUT').toUpperCase();
          out.init.push(`pinMode(${ref('pin')}, ${mode === 'PWM' ? 'OUTPUT' : mode});`);
        }
        break;

      case 'onewire':
        out.libraries.push(REGISTRY('OneWire', 'OneWire.h', 'OneWire'));
        if (has('pin')) {
          out.globals.push(`OneWire ${lower(symbol)}(${ref('pin')});`);
        } else {
          out.todos.push(`${resource.name}: OneWire needs a "pin" binding`);
        }
        break;

      case 'wifi':
        out.libraries.push(BUILTIN('WiFi', 'WiFi.h', 'Wi-Fi'));
        // The join always needs a password symbol, whether or not the model
        // mentioned one - and it must never carry a real value.
        out.defines.push(...this.secretPlaceholder(binding, symbol, 'password'));
        out.init.push(
          has('hostname') ? `WiFi.setHostname(${ref('hostname')});` : '',
          `WiFi.begin(${has('ssid') ? ref('ssid') : '""'}, ${symbol}_PASSWORD);`,
          '// Blocking here would stall fsm.update(); poll WiFi.status() instead.'
        );
        break;

      case 'ethernet':
        out.libraries.push(REGISTRY('Ethernet', 'Ethernet.h', 'Ethernet'));
        out.todos.push(`${resource.name}: call Ethernet.begin() with your MAC/DHCP settings`);
        break;

      case 'ble':
        out.libraries.push(BUILTIN('BLEDevice', 'BLEDevice.h', 'BLE'));
        out.todos.push(`${resource.name}: set up BLE services and characteristics`);
        break;

      case 'mqtt': {
        const secure = binding.tls === true;
        // Distinct library names, or a plain WiFi resource elsewhere in the
        // model would dedupe WiFiClientSecure.h away and leave the secure
        // client type undeclared.
        out.libraries.push(secure
          ? BUILTIN('WiFiClientSecure', 'WiFiClientSecure.h', 'TLS MQTT transport')
          : BUILTIN('WiFi', 'WiFi.h', 'MQTT transport'));
        out.libraries.push(REGISTRY('PubSubClient', 'PubSubClient.h', 'MQTT'));

        const client = `${lower(symbol)}Transport`;
        out.globals.push(
          `${secure ? 'WiFiClientSecure' : 'WiFiClient'} ${client};`,
          `PubSubClient ${lower(symbol)}(${client});`
        );
        if (secure) {
          out.globals.push(
            `// TODO: ${client}.setCACert(...) before connecting. Skipping`,
            '// verification would defeat the point of TLS.'
          );
        }
        out.init.push(
          `${lower(symbol)}.setServer(${has('host') ? ref('host') : '""'}, ${has('port') ? ref('port') : (secure ? 8883 : 1883)});`
        );
        out.todos.push(
          `${resource.name}: connect and re-connect without blocking, and call ` +
          `${lower(symbol)}.loop() every iteration`
        );
        break;
      }

      case 'can':
        out.todos.push(
          `${resource.name}: CAN has no single Arduino API - declare the library ` +
          'your board needs and initialise it here'
        );
        break;

      default:
        out.todos.push(`${resource.name}: custom interface, initialise it here`);
        break;
    }

    out.init = out.init.filter(Boolean);

    // Credentials get a blank placeholder so a real value never reaches git.
    for (const [key, value] of Object.entries(binding)) {
      if (SECRET_KEY.test(key)) {
        const envMatch = typeof value === 'string' ? ENV_VAR_REF.exec(value) : null;
        if (envMatch) {
          out.todos.push(`${resource.name}: ${key} sourced from \$\{${envMatch[1]}\} — define via build flag`);
        } else {
          out.todos.push(`${resource.name}: set ${symbol}_${key.toUpperCase()} before building`);
        }
      }
    }

    return out;
  }

  /**
   * A blank credential macro, emitted when generated code has to reference one
   * that the model did not supply. Defining it here keeps the sketch building
   * while still forcing the user to fill it in.
   */
  private secretPlaceholder(
    binding: Record<string, unknown>,
    symbol: string,
    key: string
  ): string[] {
    if (binding[key] !== undefined) return [];  // already emitted as a placeholder
    return [`#define ${symbol}_${key.toUpperCase()} ""  // TODO: set this; do not commit secrets to the model`];
  }

  /** Libraries the model declares explicitly, normalised for emission. */
  declared(libraries: Library[] | undefined): ImpliedLibrary[] {
    return (libraries || []).map(library => ({
      name: library.name,
      include: library.include || `${library.name}.h`,
      source: library.source === 'builtin' ? 'builtin' : 'registry',
      reason: library.description || 'declared in the model',
    }));
  }

  private defines(kind: string, binding: Record<string, unknown>, symbol: string): string[] {
    const known = KNOWN_KEYS[kind] ?? [];
    const consumed = CONSUMED_KEYS[kind] ?? [];
    const lines: string[] = [];

    for (const [key, value] of Object.entries(binding)) {
      const name = `${symbol}_${key.toUpperCase()}`;

      if (consumed.includes(key)) continue;

      // Env var reference: `${VAR_NAME}` — emit a #ifndef guard that falls
      // back to an empty string, then alias to the resource's own symbol.
      const envMatch = typeof value === 'string' ? ENV_VAR_REF.exec(value) : null;
      if (envMatch) {
        const envName = envMatch[1];
        lines.push(
          `#ifndef ${envName}`,
          `#define ${envName} ""  // pass as build flag: -D${envName}=\\"your_value\\"`,
          `#endif`,
          `#define ${name} ${envName}`,
        );
        continue;
      }

      if (SECRET_KEY.test(key)) {
        // Never inline the model's value, even if one was supplied.
        lines.push(`#define ${name} ""  // TODO: set this; do not commit secrets to the model`);
        continue;
      }

      if (!known.includes(key)) {
        lines.push(`// ${key}: ${JSON.stringify(value)}  (not used by the ${kind} backend)`);
        continue;
      }

      lines.push(`#define ${name} ${literal(value)}`);
    }

    return lines;
  }
}

/** Emit an ESP32-style call with a portable fallback for other cores. */
function guarded(preferred: string, fallback: string): string[] {
  if (preferred === fallback) return [preferred];
  return [
    '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266) || defined(ARDUINO_ARCH_RP2040)',
    `  ${preferred}`,
    '#else',
    `  ${fallback}`,
    '#endif',
  ];
}

function literal(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text = String(value);

  // Arduino pin numbers are plain ints, and "GPIO4" is not a macro any core
  // defines - so normalise the common GPIOn / IOn spellings and keep the
  // original visible. D4 and A0 are left alone; those really are macros.
  const gpio = /^(?:GPIO|IO)[_-]?(\d+)$/i.exec(text);
  if (gpio) return `${gpio[1]}  // ${text}`;

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) ? text : JSON.stringify(text);
}

function lower(symbol: string): string {
  return symbol.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
