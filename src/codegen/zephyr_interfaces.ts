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

    switch (kind) {
      case 'gpio': {
        if (!has('pin')) {
          out.todos.push(`${resource.name}: add a "pin" binding for gpio_pin_configure()`);
          break;
        }
        const rawMode = String(binding.mode ?? 'output').toUpperCase();
        const dir = rawMode === 'INPUT'         ? 'GPIO_INPUT'
                  : rawMode === 'INPUT_PULLUP'  ? '(GPIO_INPUT | GPIO_PULL_UP)'
                  : rawMode === 'INPUT_PULLDOWN' ? '(GPIO_INPUT | GPIO_PULL_DOWN)'
                  : 'GPIO_OUTPUT_INACTIVE';
        // Phase 1: raw device-pointer pattern — no app.overlay required.
        // Phase 2 will generate gpio_dt_spec + DT aliases here.
        out.init.push(
          `gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpio0)), (gpio_pin_t)(${ref('pin')}), ${dir});`,
        );
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
        out.todos.push(
          `${resource.name}: PWM — add CONFIG_PWM=y; use DEVICE_DT_GET(DT_NODELABEL(pwm0)) ` +
          'with pwm_set_dt() or pwm_set_cycles()'
        );
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
        out.todos.push(
          `${resource.name}: WiFi — add CONFIG_WIFI=y, CONFIG_NET_L2_WIFI_MGMT=y, ` +
          'CONFIG_NETWORKING=y; use net_mgmt() + wifi_connect_params. ' +
          'WiFi config is board-specific (esp32: CONFIG_ESP32_WIFI=y)'
        );
        break;
      }

      case 'mqtt': {
        out.todos.push(
          `${resource.name}: MQTT — add CONFIG_MQTT_LIB=y, CONFIG_NET_TCP=y; ` +
          'use struct mqtt_client + mqtt_connect(). Requires WiFi/Ethernet first.'
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

    out.init = out.init.filter(Boolean);
    return out;
  }

  declared(libraries: Library[] | undefined): ImpliedLibrary[] {
    return new InterfaceBackend().declared(libraries);
  }
}
