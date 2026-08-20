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
  /** Statements to call every loop() iteration (e.g. ArduinoOTA.handle()). */
  loop?: string[];
}

/**
 * Binding keys whose values must never be baked into generated source. A model
 * lives in version control; a Wi-Fi password should not.
 */
const SECRET_KEY = /(pass|password|secret|token|psk|credential|apikey|api_key)/i;

/** Max chars in an ESP32 NVS namespace (15), minus a short prefix. */
const NVS_NS_MAX_SUFFIX = 12;

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
  gpio: ['mode', 'interrupt', 'raises'],
  uart: ['port'],
  rs485: ['port'],
  mqtt: ['tls'],
  littlefs: ['format_on_fail'],
  adc: ['unit', 'conversion'],
  ota: ['hostname', 'port'],
  wifi: ['provision', 'ap_name'],
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
  rs485: ['port', 'baud', 'rx', 'tx', 'de', 're'],
  onewire: ['pin'],
  eeprom: ['size'],
  littlefs: ['format_on_fail'],
  wifi: ['ssid', 'password', 'hostname', 'provision', 'ap_name'],
  ethernet: ['cs', 'mac'],
  ble: ['name', 'service'],
  mqtt: ['host', 'port', 'prefix', 'tls', 'username', 'password', 'client_id'],
  ota: ['hostname', 'port', 'password'],
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

      case 'rs485': {
        const port = binding.port === undefined ? 1 : Number(binding.port);
        const serial = port === 0 ? 'Serial' : `Serial${port}`;
        const baud = has('baud') ? ref('baud') : '9600';
        out.init.push(
          ...guarded(
            has('rx') && has('tx')
              ? `${serial}.begin(${baud}, SERIAL_8N1, ${ref('rx')}, ${ref('tx')});`
              : `${serial}.begin(${baud});`,
            `${serial}.begin(${baud});`
          )
        );
        if (has('de')) {
          out.init.push(
            `pinMode(${ref('de')}, OUTPUT);`,
            `digitalWrite(${ref('de')}, LOW);  // start in receive mode`
          );
          if (has('re')) {
            out.init.push(
              `pinMode(${ref('re')}, OUTPUT);`,
              `digitalWrite(${ref('re')}, LOW);  // RE active-low: receiver enabled`
            );
          }
          const deNote = has('re')
            ? `set ${ref('de')} HIGH / ${ref('re')} HIGH before writing; clear both after flush`
            : `set ${ref('de')} HIGH before writing, LOW after ${serial}.flush()`;
          out.todos.push(`${resource.name}: ${deNote} — RS485 direction control`);
        } else {
          out.todos.push(
            `${resource.name}: add "de" (and optionally "re") bindings for RS485 direction control`
          );
        }
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

      case 'wifi': {
        // The join always needs a password symbol whether or not the model
        // mentioned one — it must never carry a real value.
        out.libraries.push(BUILTIN('WiFi', 'WiFi.h', 'Wi-Fi'));
        out.defines.push(...this.secretPlaceholder(binding, symbol, 'password'));

        const provision  = binding.provision === true;
        const fn         = `maintain_${lower(symbol)}`;
        const retryVar   = `_${lower(symbol)}RetryAt`;

        if (provision) {
          // ── Provisioning variant ────────────────────────────────────────────
          // Credentials are read from ESP32 NVS on boot (falling back to build
          // flags on first run). If WiFi fails 3 times in a row, the device
          // opens a provisioning AP and serves a captive-portal form
          // at 192.168.4.1. Saving new credentials writes them to NVS and
          // reboots — no rebuild needed.
          const portalFn  = `startProvisioning_${lower(symbol)}`;
          const serverVar = `_${lower(symbol)}Server`;
          const activeVar = `_${lower(symbol)}ProvisioningActive`;
          const ssidVar   = `_${lower(symbol)}Ssid`;
          const passVar   = `_${lower(symbol)}Pass`;
          const attempVar = `_${lower(symbol)}Attempts`;
          const nvsNs     = `pw_${lower(symbol).slice(0, NVS_NS_MAX_SUFFIX)}`;
          // ap_name is injected by the caller with the project name as the
          // default so each project gets a distinct AP without any user config.
          const apName    = String(binding.ap_name ?? `${lower(symbol)}-setup`);

          out.globals.push(
            '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)',
            '#ifdef ARDUINO_ARCH_ESP32',
            '#include <Preferences.h>',
            '#include <WebServer.h>',
            '#else',
            '#include <ESP8266WebServer.h>',
            'using WebServer = ESP8266WebServer;',
            '#endif',
            `static char     ${ssidVar}[33];`,
            `static char     ${passVar}[64];`,
            `static bool     ${activeVar} = false;`,
            `static WebServer ${serverVar}(80);`,
            '',
            `static void ${portalFn}() {`,
            '  WiFi.mode(WIFI_AP);',
            `  WiFi.softAP(${JSON.stringify(apName)});`,
            `  ${serverVar}.on("/", HTTP_GET, []() {`,
            `    ${serverVar}.send(200, "text/html",`,
            `      "<!doctype html><title>${apName}</title>"`,
            `      "<h2>${apName}</h2>"`,
            `      "<form method='POST' action='/save'>"`,
            `      "SSID: <input name='ssid' required><br><br>"`,
            `      "Password: <input type='password' name='pass'><br><br>"`,
            `      "<button type='submit'>Save &amp; Reboot</button></form>");`,
            '  });',
            `  ${serverVar}.on("/save", HTTP_POST, []() {`,
            `    String _s = ${serverVar}.arg("ssid");`,
            `    String _p = ${serverVar}.arg("pass");`,
            '    #ifdef ARDUINO_ARCH_ESP32',
            '    Preferences _prefs;',
            `    _prefs.begin("${nvsNs}", false);`,
            '    _prefs.putString("ssid", _s);',
            '    _prefs.putString("pass", _p);',
            '    _prefs.end();',
            '    #endif',
            `    ${serverVar}.send(200, "text/html", "<h2>Saved - rebooting...</h2>");`,
            '    delay(1000);',
            '    ESP.restart();',
            '  });',
            `  ${serverVar}.begin();`,
            `  ${activeVar} = true;`,
            '}',
            '',
            `static void ${fn}() {`,
            `  if (${activeVar}) { ${serverVar}.handleClient(); return; }`,
            '  if (WiFi.status() == WL_CONNECTED) return;',
            `  static unsigned long ${retryVar}  = 0;`,
            `  static uint8_t       ${attempVar} = 0;`,
            '  const unsigned long _now = millis();',
            `  if (_now - ${retryVar} < 5000UL) return;`,
            `  ${retryVar} = _now;`,
            `  if (${attempVar} >= 3) { ${portalFn}(); return; }`,
            `  ${attempVar}++;`,
            '  WiFi.disconnect();',
            `  WiFi.begin(${ssidVar}, ${passVar});`,
            '}',
            '#endif  // ARDUINO_ARCH_ESP32 || ARDUINO_ARCH_ESP8266',
          );

          out.init.push(
            has('hostname') ? `WiFi.setHostname(${ref('hostname')});` : '',
            '#ifdef ARDUINO_ARCH_ESP32',
            '{',
            '  Preferences _p;',
            `  _p.begin("${nvsNs}", true);`,
            '  String _s = _p.getString("ssid", "");',
            '  String _w = _p.getString("pass", "");',
            '  _p.end();',
            `  strlcpy(${ssidVar}, _s.length() ? _s.c_str() : ${symbol}_SSID,     sizeof(${ssidVar}));`,
            `  strlcpy(${passVar}, _w.length() ? _w.c_str() : ${symbol}_PASSWORD, sizeof(${passVar}));`,
            '}',
            '#else',
            `strlcpy(${ssidVar}, ${symbol}_SSID,     sizeof(${ssidVar}));`,
            `strlcpy(${passVar}, ${symbol}_PASSWORD, sizeof(${passVar}));`,
            '#endif',
            `WiFi.begin(${ssidVar}, ${passVar});`,
          );
        } else {
          // ── Simple reconnect variant ────────────────────────────────────────
          // If the connection drops, maintain_*() retries every 5 seconds.
          // Credentials always come from build flags.
          out.globals.push(
            '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)',
            `static void ${fn}() {`,
            '  if (WiFi.status() == WL_CONNECTED) return;',
            `  static unsigned long ${retryVar} = 0;`,
            '  const unsigned long _now = millis();',
            `  if (_now - ${retryVar} < 5000UL) return;`,
            `  ${retryVar} = _now;`,
            '  WiFi.disconnect();',
            `  WiFi.begin(${has('ssid') ? ref('ssid') : '""'}, ${symbol}_PASSWORD);`,
            '}',
            '#endif',
          );

          out.init.push(
            has('hostname') ? `WiFi.setHostname(${ref('hostname')});` : '',
            `WiFi.begin(${has('ssid') ? ref('ssid') : '""'}, ${symbol}_PASSWORD);`,
          );
        }

        // Both variants run the maintain function every loop() tick.
        out.loop = [
          '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)',
          `  ${fn}();`,
          '#endif',
        ];
        break;
      }

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

      case 'eeprom':
        out.libraries.push(BUILTIN('EEPROM', 'EEPROM.h', 'EEPROM'));
        out.init.push(
          // ESP32 emulates EEPROM over flash and needs a byte-count up front;
          // AVR has hardware EEPROM and needs no begin() at all.
          '#ifdef ARDUINO_ARCH_ESP32',
          `  EEPROM.begin(${has('size') ? ref('size') : '512'});`,
          '#endif'
        );
        out.todos.push(
          `${resource.name}: call EEPROM.commit() after every write on ESP32 — ` +
          'AVR hardware EEPROM commits automatically'
        );
        break;

      case 'littlefs': {
        out.libraries.push(BUILTIN('LittleFS', 'LittleFS.h', 'LittleFS'));
        const formatOnFail = binding.format_on_fail === true;
        out.init.push(
          `if (!LittleFS.begin(${formatOnFail ? 'true' : 'false'})) {`,
          `  // TODO: ${resource.name}: mount failed${formatOnFail
            ? ' — formatted and retrying'
            : ' — call LittleFS.format() to initialise the partition'}.`,
          `}`
        );
        out.todos.push(
          `${resource.name}: always close files after use — LittleFS has a limited handle pool`
        );
        break;
      }

      case 'can': {
        const bitrateRaw = Number(binding.bitrate ?? 500000);
        const timingMacro = canTimingMacro(bitrateRaw);
        const sym = symbol;
        const hasTx = binding.tx !== undefined;
        const hasRx = binding.rx !== undefined;

        // ESP32 TWAI (the built-in CAN peripheral). The sketch stays portable:
        // non-ESP32 targets get a TODO that names the peripheral they need.
        out.globals.push(
          '#ifdef ARDUINO_ARCH_ESP32',
          '#include <driver/twai.h>',
          '#endif',
        );
        const txExpr = hasTx ? `(gpio_num_t)${sym}_TX` : '(gpio_num_t)4';
        const rxExpr = hasRx ? `(gpio_num_t)${sym}_RX` : '(gpio_num_t)5';
        out.init.push(
          '#ifdef ARDUINO_ARCH_ESP32',
          `  static const twai_general_config_t ${sym}_g =`,
          `    TWAI_GENERAL_CONFIG_DEFAULT(${txExpr}, ${rxExpr}, TWAI_MODE_NORMAL);`,
          `  static const twai_timing_config_t ${sym}_t = ${timingMacro};`,
          `  static const twai_filter_config_t ${sym}_f = TWAI_FILTER_CONFIG_ACCEPT_ALL();`,
          `  twai_driver_install(&${sym}_g, &${sym}_t, &${sym}_f);`,
          '  twai_start();',
          '#else',
          `  // TODO: ${resource.name}: add your CAN library initialization here (e.g. MCP2515).`,
          '#endif',
        );
        break;
      }

      case 'ota': {
        // ArduinoOTA is bundled with the ESP32 and ESP8266 Arduino cores.
        // Requires: ArduinoOTA — install via Boards Manager (included in esp32/esp8266 core)
        out.libraries.push(BUILTIN('ArduinoOTA', 'ArduinoOTA.h', 'OTA firmware updates'));
        const hostname = binding.hostname as string | undefined;
        const port     = binding.port !== undefined ? Number(binding.port) : undefined;
        const initLines: string[] = [
          '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)',
        ];
        if (hostname) initLines.push(`  ArduinoOTA.setHostname(${JSON.stringify(hostname)});`);
        if (port !== undefined) initLines.push(`  ArduinoOTA.setPort(${port});`);
        // password is caught by SECRET_KEY above and emitted as a TODO; the
        // user fills it in before ArduinoOTA.begin().
        initLines.push(
          '  ArduinoOTA.begin();',
          '#else',
          `  // TODO: ${resource.name}: ArduinoOTA is only available on ESP32/ESP8266.`,
          '#endif',
        );
        out.init.push(...initLines);
        out.loop = [
          '#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)',
          '  ArduinoOTA.handle();',
          '#endif',
        ];
        out.todos.push(
          `${resource.name}: WiFi must be connected before ArduinoOTA.begin() runs`
        );
        break;
      }

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

/** Map a declared bitrate (bps) to the ESP32 TWAI timing-config macro name. */
function canTimingMacro(bitrate: number): string {
  const map: Record<number, string> = {
    25000:   'TWAI_TIMING_CONFIG_25KBITS()',
    50000:   'TWAI_TIMING_CONFIG_50KBITS()',
    100000:  'TWAI_TIMING_CONFIG_100KBITS()',
    125000:  'TWAI_TIMING_CONFIG_125KBITS()',
    250000:  'TWAI_TIMING_CONFIG_250KBITS()',
    500000:  'TWAI_TIMING_CONFIG_500KBITS()',
    800000:  'TWAI_TIMING_CONFIG_800KBITS()',
    1000000: 'TWAI_TIMING_CONFIG_1MBITS()',
  };
  return map[bitrate] ?? 'TWAI_TIMING_CONFIG_500KBITS()  // adjust for your declared bitrate';
}
