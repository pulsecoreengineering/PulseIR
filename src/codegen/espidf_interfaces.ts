/**
 * ESP-IDF interface backend for PulseIR.
 *
 * Translates platform-agnostic resource declarations into ESP-IDF driver
 * initialisation calls. Pin/setting macros (#define SYMBOL_PIN N) are
 * reused from InterfaceBackend — they are platform-agnostic — so this
 * module only overrides the init, globals and libraries fields.
 *
 * ESP-IDF does not use Arduino library headers, so no Arduino-style
 * ImpliedLibrary objects are returned; the necessary IDF component headers
 * are added as builtin includes instead.
 */

import type { Resource, Library } from '../model/index.js';
import { InterfaceBackend } from './interfaces.js';
import type { ImpliedLibrary, InterfaceEmission } from './interfaces.js';

const IDF = (include: string, reason: string): ImpliedLibrary =>
  ({ name: include.replace(/[/.].*$/, ''), include, source: 'builtin', reason });

export class EspIdfInterfaceBackend {
  /** Arduino backend used only to generate platform-agnostic #define macros. */
  private readonly defines = new InterfaceBackend();

  emit(resource: Resource, symbol: string): InterfaceEmission {
    // Reuse the Arduino backend's define generation: pin/setting #defines
    // are pure arithmetic mappings (symbol + binding key → macro name/value)
    // with no platform assumption baked in.
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
          out.todos.push(`${resource.name}: add a "pin" binding for gpio_config()`);
          break;
        }
        const rawMode = String(binding.mode || 'output').toUpperCase();
        const gpioMode = rawMode === 'INPUT'         ? 'GPIO_MODE_INPUT'
                       : rawMode === 'INPUT_PULLUP'  ? 'GPIO_MODE_INPUT'
                       : rawMode === 'INPUT_PULLDOWN' ? 'GPIO_MODE_INPUT'
                       : 'GPIO_MODE_OUTPUT';
        const pullUp   = rawMode === 'INPUT_PULLUP'   ? 'GPIO_PULLUP_ENABLE'   : 'GPIO_PULLUP_DISABLE';
        const pullDown = rawMode === 'INPUT_PULLDOWN' ? 'GPIO_PULLDOWN_ENABLE' : 'GPIO_PULLDOWN_DISABLE';
        out.init.push(
          '{',
          `  gpio_config_t _cfg = {};`,
          `  _cfg.pin_bit_mask = (1ULL << ${ref('pin')});`,
          `  _cfg.mode         = ${gpioMode};`,
          `  _cfg.pull_up_en   = ${pullUp};`,
          `  _cfg.pull_down_en = ${pullDown};`,
          `  _cfg.intr_type    = GPIO_INTR_DISABLE;`,
          `  gpio_config(&_cfg);`,
          '}',
        );
        break;
      }

      case 'uart': {
        out.libraries.push(IDF('driver/uart.h', 'UART'));
        const port    = binding.port === undefined ? 0 : Number(binding.port);
        const uartNum = `UART_NUM_${port}`;
        const baud    = has('baud') ? ref('baud') : '115200';
        out.init.push(
          '{',
          `  const uart_config_t _cfg = {`,
          `    .baud_rate  = (int)(${baud}),`,
          `    .data_bits  = UART_DATA_8_BITS,`,
          `    .parity     = UART_PARITY_DISABLE,`,
          `    .stop_bits  = UART_STOP_BITS_1,`,
          `    .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,`,
          `    .source_clk = UART_SCLK_DEFAULT,`,
          `  };`,
          `  uart_param_config(${uartNum}, &_cfg);`,
          has('rx') && has('tx')
            ? `  uart_set_pin(${uartNum}, ${ref('tx')}, ${ref('rx')}, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);`
            : `  // uart_set_pin(${uartNum}, TX_PIN, RX_PIN, ...); — add tx/rx bindings to set custom pins`,
          `  uart_driver_install(${uartNum}, 256, 0, 0, NULL, 0);`,
          '}',
        );
        break;
      }

      case 'rs485': {
        out.libraries.push(IDF('driver/uart.h', 'RS-485 via UART'));
        const port    = binding.port === undefined ? 1 : Number(binding.port);
        const uartNum = `UART_NUM_${port}`;
        const baud    = has('baud') ? ref('baud') : '9600';
        out.init.push(
          '{',
          `  const uart_config_t _cfg = {`,
          `    .baud_rate  = (int)(${baud}),`,
          `    .data_bits  = UART_DATA_8_BITS,`,
          `    .parity     = UART_PARITY_DISABLE,`,
          `    .stop_bits  = UART_STOP_BITS_1,`,
          `    .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,`,
          `    .source_clk = UART_SCLK_DEFAULT,`,
          `  };`,
          `  uart_param_config(${uartNum}, &_cfg);`,
          has('rx') && has('tx')
            ? `  uart_set_pin(${uartNum}, ${ref('tx')}, ${ref('rx')}, ` +
              (has('de') ? `${ref('de')}, ` : 'UART_PIN_NO_CHANGE, ') +
              `UART_PIN_NO_CHANGE);`
            : `  // uart_set_pin(${uartNum}, TX_PIN, RX_PIN, ...); — add tx/rx bindings`,
          `  uart_set_mode(${uartNum}, UART_MODE_RS485_HALF_DUPLEX);`,
          `  uart_driver_install(${uartNum}, 256, 0, 0, NULL, 0);`,
          '}',
        );
        if (!has('de')) {
          out.todos.push(`${resource.name}: add a "de" binding for the RS-485 direction pin`);
        }
        break;
      }

      case 'i2c': {
        out.libraries.push(IDF('driver/i2c.h', 'I2C'));
        const sda  = has('sda') ? `(gpio_num_t)(${ref('sda')})` : '(gpio_num_t)21';
        const scl  = has('scl') ? `(gpio_num_t)(${ref('scl')})` : '(gpio_num_t)22';
        const freq = has('frequency') ? ref('frequency') : '400000';
        out.init.push(
          '{',
          `  const i2c_config_t _cfg = {`,
          `    .mode             = I2C_MODE_MASTER,`,
          `    .sda_io_num       = ${sda},`,
          `    .scl_io_num       = ${scl},`,
          `    .sda_pullup_en    = GPIO_PULLUP_ENABLE,`,
          `    .scl_pullup_en    = GPIO_PULLUP_ENABLE,`,
          `    .master.clk_speed = (uint32_t)(${freq}),`,
          `  };`,
          `  i2c_param_config(I2C_NUM_0, &_cfg);`,
          `  i2c_driver_install(I2C_NUM_0, I2C_MODE_MASTER, 0, 0, 0);`,
          '}',
        );
        break;
      }

      case 'spi': {
        out.libraries.push(IDF('driver/spi_master.h', 'SPI'));
        const mosi = has('mosi') ? `(gpio_num_t)(${ref('mosi')})` : '(gpio_num_t)23';
        const miso = has('miso') ? `(gpio_num_t)(${ref('miso')})` : '(gpio_num_t)19';
        const sck  = has('sck')  ? `(gpio_num_t)(${ref('sck')})`  : '(gpio_num_t)18';
        out.init.push(
          '{',
          `  const spi_bus_config_t _cfg = {`,
          `    .mosi_io_num     = ${mosi},`,
          `    .miso_io_num     = ${miso},`,
          `    .sclk_io_num     = ${sck},`,
          `    .quadwp_io_num   = -1,`,
          `    .quadhd_io_num   = -1,`,
          `    .max_transfer_sz = 4096,`,
          `  };`,
          `  spi_bus_initialize(SPI2_HOST, &_cfg, SPI_DMA_CH_AUTO);`,
          '}',
        );
        if (has('cs')) {
          out.init.push(
            `gpio_set_direction((gpio_num_t)(${ref('cs')}), GPIO_MODE_OUTPUT);`,
            `gpio_set_level((gpio_num_t)(${ref('cs')}), 1);  // CS deasserted (active-low)`,
          );
        }
        break;
      }

      case 'pwm': {
        out.libraries.push(IDF('driver/ledc.h', 'LEDC PWM'));
        if (!has('pin') || !has('channel')) {
          out.todos.push(`${resource.name}: add "pin" and "channel" bindings for ledc_channel_config()`);
          break;
        }
        const freq       = has('frequency') ? ref('frequency') : '5000';
        const resolution = has('resolution') ? `(ledc_timer_bit_t)(${ref('resolution')})` : 'LEDC_TIMER_8_BIT';
        out.init.push(
          '{',
          `  const ledc_timer_config_t _timer = {`,
          `    .speed_mode      = LEDC_HIGH_SPEED_MODE,`,
          `    .duty_resolution = ${resolution},`,
          `    .timer_num       = LEDC_TIMER_0,`,
          `    .freq_hz         = (uint32_t)(${freq}),`,
          `    .clk_cfg         = LEDC_AUTO_CLK,`,
          `  };`,
          `  ledc_timer_config(&_timer);`,
          `  const ledc_channel_config_t _ch = {`,
          `    .gpio_num   = (gpio_num_t)(${ref('pin')}),`,
          `    .speed_mode = LEDC_HIGH_SPEED_MODE,`,
          `    .channel    = (ledc_channel_t)(${ref('channel')}),`,
          `    .timer_sel  = LEDC_TIMER_0,`,
          `    .duty       = 0,`,
          `    .hpoint     = 0,`,
          `    .flags      = { .output_invert = 0 },`,
          `  };`,
          `  ledc_channel_config(&_ch);`,
          '}',
        );
        break;
      }

      case 'adc': {
        out.libraries.push(IDF('driver/adc.h', 'ADC (legacy driver; IDF ≥5.0: esp_adc/adc_oneshot.h)'));
        if (has('pin')) {
          out.init.push(
            `adc1_config_width(ADC_WIDTH_BIT_12);`,
            // adc1_channel_t != gpio pin; users must map pin to channel enum
            `adc1_config_channel_atten((adc1_channel_t)(${ref('pin')}), ${
              has('attenuation') ? ref('attenuation') : 'ADC_ATTEN_DB_12'
            });`,
          );
          out.todos.push(
            `${resource.name}: replace (adc1_channel_t)(${ref('pin')}) with the correct ADC1_CHANNEL_N ` +
            'enum — GPIO numbers and channel numbers are not the same on ESP32.'
          );
        }
        break;
      }

      case 'wifi': {
        out.libraries.push(IDF('esp_wifi.h',  'Wi-Fi'));
        out.libraries.push(IDF('nvs_flash.h', 'NVS (required by Wi-Fi stack)'));
        out.todos.push(
          `${resource.name}: call nvs_flash_init(), esp_netif_init(), esp_event_loop_create_default(), ` +
          'esp_wifi_init(), esp_wifi_set_config() and esp_wifi_start() in order'
        );
        break;
      }

      case 'mqtt': {
        out.libraries.push(IDF('mqtt_client.h', 'ESP-IDF MQTT client'));
        out.todos.push(
          `${resource.name}: create esp_mqtt_client_config_t (set .broker.address.uri), ` +
          'call esp_mqtt_client_init() and esp_mqtt_client_start()'
        );
        break;
      }

      case 'eeprom':
        out.libraries.push(IDF('nvs.h', 'NVS (persistent key-value store, replaces EEPROM on ESP32)'));
        out.todos.push(
          `${resource.name}: use nvs_open() / nvs_set_* / nvs_commit() / nvs_close() — ` +
          'ESP-IDF has no EEPROM peripheral; NVS is the idiomatic replacement'
        );
        break;

      case 'littlefs': {
        out.libraries.push(IDF('esp_littlefs.h', 'LittleFS on ESP-IDF'));
        const formatOnFail = binding.format_on_fail === true;
        out.init.push(
          '{',
          `  const esp_vfs_littlefs_conf_t _cfg = {`,
          `    .base_path              = "/littlefs",`,
          `    .partition_label        = "littlefs",`,
          `    .format_if_mount_failed = ${formatOnFail},`,
          `  };`,
          `  esp_vfs_littlefs_register(&_cfg);`,
          '}',
        );
        out.todos.push(
          `${resource.name}: add a "littlefs" partition (64KB minimum) to your partition table`
        );
        break;
      }

      case 'can': {
        out.libraries.push(IDF('driver/twai.h', 'TWAI/CAN'));
        out.todos.push(
          `${resource.name}: configure twai_general_config_t, twai_timing_config_t and ` +
          'twai_filter_config_t, then call twai_driver_install() and twai_start()'
        );
        break;
      }

      case 'onewire':
        out.todos.push(
          `${resource.name}: 1-Wire is not a native ESP-IDF peripheral — ` +
          'use the esp-idf-owb or similar component from the ESP-IDF Component Registry'
        );
        break;

      case 'ble':
        out.libraries.push(IDF('esp_bt.h',       'Bluetooth'));
        out.libraries.push(IDF('esp_gap_ble_api.h', 'BLE GAP'));
        out.todos.push(
          `${resource.name}: initialise BT controller, bluedroid stack, then set up GATT/GAP`
        );
        break;

      case 'ethernet': {
        out.libraries.push(IDF('esp_eth.h', 'Ethernet'));
        out.todos.push(
          `${resource.name}: configure esp_eth_mac_new_esp32() (or SPI MAC) and ` +
          'esp_eth_phy_new_*(), then call esp_eth_driver_install() and esp_eth_start()'
        );
        break;
      }

      default:
        out.todos.push(`${resource.name}: custom interface — add your ESP-IDF driver initialisation`);
        break;
    }

    out.init = out.init.filter(Boolean);

    return out;
  }

  declared(libraries: Library[] | undefined): ImpliedLibrary[] {
    // Delegate: the name/include/source/reason mapping is platform-agnostic.
    return new InterfaceBackend().declared(libraries);
  }
}
