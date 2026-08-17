/**
 * Zephyr RTOS interface backend for PulseIR.
 *
 * Translates platform-agnostic resource declarations into Zephyr kernel API
 * initialisations. This is Phase 1: GPIO uses the raw device-pointer pattern
 * (gpio_pin_configure + DEVICE_DT_GET) which compiles on native_sim without
 * an app.overlay. Phase 2 will upgrade GPIO to gpio_dt_spec with DT aliases.
 *
 * Pin #define macros are reused from InterfaceBackend — they are
 * platform-agnostic arithmetic mappings with no platform assumption baked in.
 */

import type { Resource, Library } from '../model/index.js';
import { InterfaceBackend } from './interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';

const REGISTRY = (name: string, include: string, reason: string): ImpliedLibrary =>
  ({ name, include, source: 'registry', reason });

function lower(symbol: string): string {
  return symbol.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export class ZephyrInterfaceBackend {
  /** Reused only for the platform-agnostic #define generation. */
  private readonly defines = new InterfaceBackend();

  emit(resource: Resource, symbol: string): InterfaceEmission {
    const { defines, todos: defineTodos } = this.defines.emit(resource, symbol);

    const out: InterfaceEmission = {
      defines,
      globals: [],
      init: [],
      libraries: [],
      todos: [...defineTodos],
    };

    const binding = resource.binding || {};
    const kind = String(resource.interface);
    const has = (key: string): boolean => binding[key] !== undefined;
    const ref = (key: string): string => `${symbol}_${key.toUpperCase()}`;

    let gpioSpecEmitted = false;

    switch (kind) {
      case 'gpio': {
        if (!has('pin')) {
          out.todos.push(`${resource.name}: add a "pin" binding for gpio_pin_configure_dt()`);
          break;
        }
        const rawMode = String(binding.mode ?? 'output').toUpperCase();
        const dir = rawMode === 'INPUT'          ? 'GPIO_INPUT'
                  : rawMode === 'INPUT_PULLUP'   ? '(GPIO_INPUT | GPIO_PULL_UP)'
                  : rawMode === 'INPUT_PULLDOWN' ? '(GPIO_INPUT | GPIO_PULL_DOWN)'
                  : 'GPIO_OUTPUT_INACTIVE';
        // Phase 2: gpio_dt_spec — app.overlay declares the gpio0 node properties.
        const specName = `${symbol}_GPIO`;
        const propName = `${symbol.toLowerCase()}_gpios`;
        out.globals.push(
          `static const struct gpio_dt_spec ${specName} = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), ${propName});`,
        );
        out.init.push(
          `gpio_pin_configure_dt(&${specName}, ${dir});`,
        );
        gpioSpecEmitted = true;
        break;
      }

      case 'uart': {
        const port    = binding.port === undefined ? 0 : Number(binding.port);
        const baud    = has('baud') ? ref('baud') : '115200';
        // native_sim uses the console UART by default; on real hardware set
        // CONFIG_UART_0_INIT_PRIORITY / uart_configure() after init.
        out.todos.push(
          `${resource.name}: UART port ${port} — call uart_configure() with baud_rate=${baud} ` +
          'if non-default config is needed; DT_NODELABEL(uart' + port + ') selects the device'
        );
        break;
      }

      case 'i2c': {
        const freq = has('frequency') ? ref('frequency') : '400000';
        out.todos.push(
          `${resource.name}: I2C — add CONFIG_I2C=y to prj.conf; ` +
          `use DEVICE_DT_GET(DT_NODELABEL(i2c0)) with i2c_configure() at ${freq} Hz`
        );
        break;
      }

      case 'spi': {
        out.todos.push(
          `${resource.name}: SPI — add CONFIG_SPI=y to prj.conf; ` +
          'use DEVICE_DT_GET(DT_NODELABEL(spi0)) with struct spi_config'
        );
        break;
      }

      case 'pwm': {
        if (!has('pin')) {
          out.todos.push(`${resource.name}: add a "pin" binding for pwm_set_dt()`);
          break;
        }
        // Ensure FREQUENCY and RESOLUTION macros exist — pwmWriteLines() references both.
        if (!has('frequency')) out.defines.push(`#define ${symbol}_FREQUENCY 5000`);
        if (!has('resolution')) out.defines.push(`#define ${symbol}_RESOLUTION 8`);

        const specName = `${symbol}_PWM`;
        const propName = `${symbol.toLowerCase()}_pwms`;
        out.globals.push(
          `static const struct pwm_dt_spec ${specName} = PWM_DT_SPEC_GET(DT_PATH(zephyr_user), ${propName});`,
        );
        // pwm_set_dt() configures and drives on first call — no separate init needed.
        break;
      }

      case 'adc': {
        out.todos.push(
          `${resource.name}: ADC — add CONFIG_ADC=y; use DEVICE_DT_GET(DT_NODELABEL(adc0)) ` +
          'with struct adc_channel_cfg and adc_read()'
        );
        break;
      }

      case 'wifi': {
        // Phase 4: real Zephyr WiFi API via net_mgmt() + wifi_connect_req_params.
        //
        // The base InterfaceBackend.defines() already emits ${symbol}_SSID and
        // ${symbol}_PASSWORD macros. ${symbol}_PASSWORD expands to "" (empty
        // string — secret placeholder). ${symbol}_SSID may expand to a bare
        // identifier (via the literal() helper) which is not a valid string
        // literal. Emit dedicated string defines so the struct initializer is
        // always syntactically correct.
        const ssid = String(binding.ssid ?? '');
        out.defines.push(
          `#define ${symbol}_SSID_STR  ${JSON.stringify(ssid || 'YOUR_WIFI_SSID')}`,
          `// ${symbol}_PASSWORD (set via build flag, not stored in source)`,
        );
        out.globals.push(
          `static struct net_if *${lower(symbol)}_iface = NULL;`,
          `static struct wifi_connect_req_params ${lower(symbol)}_params = {`,
          `    .ssid        = (const uint8_t *)${symbol}_SSID_STR,`,
          `    .ssid_length = (uint8_t)(sizeof(${symbol}_SSID_STR) - 1),`,
          `    .psk         = (const uint8_t *)${symbol}_PASSWORD,`,
          `    .psk_length  = (uint8_t)(sizeof(${symbol}_PASSWORD) - 1),`,
          `    .security    = WIFI_SECURITY_TYPE_PSK,`,
          `    .channel     = WIFI_CHANNEL_ANY,`,
          `    .band        = WIFI_FREQ_BAND_2_4_GHZ,`,
          `};`,
        );
        out.init.push(
          `${lower(symbol)}_iface = net_if_get_default();`,
          `net_mgmt(NET_REQUEST_WIFI_CONNECT, ${lower(symbol)}_iface,`,
          `         &${lower(symbol)}_params, sizeof(${lower(symbol)}_params));`,
        );
        break;
      }

      case 'mqtt': {
        // Phase 4: real Zephyr MQTT API via struct mqtt_client + mqtt_connect().
        // A thin C++ shim class (ZephyrMqttClient) wraps mqtt_client with the
        // PubSubClient-compatible API that the generated connectMqtt() /
        // publishMqtt() wiring expects, so those helpers compile unchanged.
        //
        // ${symbol}_HOST and ${symbol}_PORT are emitted by the shared
        // InterfaceBackend.defines() call above when host/port are declared in
        // the model binding. Emit fallbacks only when they are absent.
        if (!has('host')) out.defines.push(`#define ${symbol}_HOST "192.168.1.1"  /* TODO: set MQTT broker address */`);
        if (!has('port')) out.defines.push(`#define ${symbol}_PORT 1883`);
        out.globals.push(
          // Shim class — defined only once per translation unit via the guard.
          '#ifndef PULSE_ZEPHYR_MQTT_SHIM',
          '#define PULSE_ZEPHYR_MQTT_SHIM',
          'class ZephyrMqttClient {',
          '  struct mqtt_client  _client;',
          '  uint8_t             _rx[256], _tx[256];',
          '  struct sockaddr_in  _broker_sa;',
          'public:',
          '  void begin(const char *addr, uint16_t port) {',
          '    mqtt_client_init(&_client);',
          '    _broker_sa.sin_family = AF_INET;',
          '    _broker_sa.sin_port   = htons(port);',
          '    /* zsock_inet_pton(AF_INET, addr, &_broker_sa.sin_addr); */',
          '    _client.broker      = (struct sockaddr *)&_broker_sa;',
          '    _client.rx_buf      = _rx;  _client.rx_buf_size = sizeof(_rx);',
          '    _client.tx_buf      = _tx;  _client.tx_buf_size = sizeof(_tx);',
          '    _client.protocol    = MQTT_VERSION_3_1_1;',
          '    (void)addr;',
          '  }',
          '  bool connected() const { return false; /* TODO: track mqtt_connect state */ }',
          '  bool connect(const char *id) {',
          '    (void)id;',
          '    return mqtt_connect(&_client) == 0;',
          '  }',
          '  void disconnect() { mqtt_disconnect(&_client); }',
          '  bool subscribe(const char *topic) { (void)topic; return false; /* TODO: mqtt_subscribe */ }',
          '  bool publish(const char *topic, const char *payload) {',
          '    (void)topic; (void)payload;',
          '    return false; /* TODO: mqtt_publish */;',
          '  }',
          '  void setCallback(void (*cb)(char*, uint8_t*, unsigned int)) { (void)cb; }',
          '  void loop() { /* TODO: mqtt_input(&_client); mqtt_live(&_client); */ }',
          '};',
          '#endif /* PULSE_ZEPHYR_MQTT_SHIM */',
          `static ZephyrMqttClient ${lower(symbol)};`,
        );
        out.init.push(
          `${lower(symbol)}.begin(${symbol}_HOST, (uint16_t)(${symbol}_PORT));`,
        );
        break;
      }

      case 'ota': {
        out.todos.push(
          `${resource.name}: OTA — add CONFIG_BOOTLOADER_MCUBOOT=y, CONFIG_MCUBOOT_IMG_MANAGER=y; ` +
          'use boot_request_upgrade(BOOT_UPGRADE_TEST) after downloading the image'
        );
        break;
      }

      case 'eeprom':
      case 'littlefs': {
        out.todos.push(
          `${resource.name}: persistent storage — add CONFIG_NVS=y (for small K/V data) or ` +
          'CONFIG_FILE_SYSTEM=y + CONFIG_FS_LITTLEFS=y (for file storage)'
        );
        break;
      }

      case 'can': {
        out.todos.push(
          `${resource.name}: CAN — add CONFIG_CAN=y; use DEVICE_DT_GET(DT_NODELABEL(can0)) ` +
          'with can_set_bitrate() and can_start()'
        );
        break;
      }

      case 'onewire': {
        out.todos.push(
          `${resource.name}: 1-Wire is not a native Zephyr peripheral — ` +
          'use a bit-bang driver via GPIO (CONFIG_GPIO=y)'
        );
        // Phase 1 stub: emit an OneWire global so library-backed sensors (ds18b20)
        // that reference this bus compile. Replace with a GPIO bit-bang driver
        // in production.
        if (has('pin')) {
          out.libraries.push(REGISTRY('OneWire', 'OneWire.h', '1-Wire bus (Phase 1 stub)'));
          out.globals.push(
            `OneWire ${lower(symbol)}(${ref('pin')});  // Phase 1 stub — replace with GPIO bit-bang`,
          );
        }
        break;
      }

      case 'ble': {
        out.todos.push(
          `${resource.name}: BLE — add CONFIG_BT=y, CONFIG_BT_PERIPHERAL=y (or CENTRAL); ` +
          'use bt_enable() + bt_le_adv_start() for advertising'
        );
        break;
      }

      case 'ethernet': {
        out.todos.push(
          `${resource.name}: Ethernet — add CONFIG_NET_L2_ETHERNET=y; ` +
          'DT node depends on board (e.g. DT_NODELABEL(eth0))'
        );
        break;
      }

      default:
        out.todos.push(
          `${resource.name}: custom interface — add your Zephyr driver initialisation`
        );
        break;
    }

    // Any device with a pin may be targeted by gpio_control, even if its primary
    // interface is PWM or ADC. Declare a gpio_dt_spec so those actions compile.
    if (has('pin') && !gpioSpecEmitted) {
      const specName = `${symbol}_GPIO`;
      const propName = `${symbol.toLowerCase()}_gpios`;
      out.globals.push(
        `static const struct gpio_dt_spec ${specName} = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), ${propName});`,
      );
    }

    out.init = out.init.filter(Boolean);
    return out;
  }

  declared(libraries: Library[] | undefined): ImpliedLibrary[] {
    return new InterfaceBackend().declared(libraries);
  }
}
