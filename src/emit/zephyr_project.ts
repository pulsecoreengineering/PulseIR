/**
 * Zephyr project file emitter for the west/Zephyr target.
 *
 * Generates the build-system files that sit alongside the C++ source:
 *
 *   CMakeLists.txt — wires src/main.cpp (and PulseHSM.cpp when a machine is
 *                    declared) into the Zephyr build system via find_package(Zephyr).
 *   prj.conf       — Kconfig options derived from the hardware declared in the
 *                    model.  The emitter scans bus resources and device types so
 *                    the user never has to know which CONFIG_* their model needs.
 *
 * Phase 1: generates files that compile on native_sim without an app.overlay.
 * Phase 2 will add app.overlay generation for gpio_dt_spec + DT aliases.
 */

import type { PulseProject } from '../model/index.js';

export interface ZephyrProjectFiles {
  /** Root CMakeLists.txt — handed directly to `west build`. */
  cmake: string;
  /** prj.conf — Kconfig selections for this model's hardware and language requirements. */
  prjConf: string;
}

export class ZephyrProjectEmitter {
  generate(project: PulseProject): ZephyrProjectFiles {
    const hasMachine  = project.system.states.length > 0;
    const resources   = project.system.resources  ?? [];
    const components  = project.system.components ?? [];

    // Bus interface types declared in hardware.buses.
    const busIfaces = new Set(resources.map(r => String(r.interface)));

    // Device types declared in hardware.devices (digital_output / digital_input
    // both use the GPIO driver, so either one enables CONFIG_GPIO).
    const deviceTypes = new Set(components.map(c => String(c.type ?? '')));
    const hasGpioDevices =
      deviceTypes.has('digital_output') || deviceTypes.has('digital_input');

    return {
      cmake:   this.cmake(project.name, hasMachine),
      prjConf: this.prjConf(busIfaces, hasGpioDevices),
    };
  }

  private cmake(projectName: string, hasMachine: boolean): string {
    const safe     = projectName.replace(/[^A-Za-z0-9_]/g, '_');
    const extraSrc = hasMachine ? '\n    PulseHSM.cpp' : '';

    return [
      'cmake_minimum_required(VERSION 3.20.0)',
      '',
      '# West/Zephyr build system — must come before project().',
      'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
      `project(${safe})`,
      '',
      'target_sources(app PRIVATE',
      `    src/main.cpp${extraSrc}`,
      ')',
      '',
    ].join('\n');
  }

  private prjConf(busIfaces: Set<string>, hasGpioDevices: boolean): string {
    const lines: string[] = [
      '# C++ language support',
      'CONFIG_CPP=y',
      'CONFIG_STD_CPP17=y',
      'CONFIG_NEWLIB_LIBC=y',
    ];

    const add = (comment: string, ...configs: string[]) => {
      lines.push('', `# ${comment}`, ...configs);
    };

    if (busIfaces.has('gpio') || hasGpioDevices) {
      add('GPIO driver', 'CONFIG_GPIO=y');
    }
    if (busIfaces.has('uart')) {
      add('Serial / UART driver', 'CONFIG_SERIAL=y');
    }
    if (busIfaces.has('i2c')) {
      add('I2C driver', 'CONFIG_I2C=y');
    }
    if (busIfaces.has('spi')) {
      add('SPI driver', 'CONFIG_SPI=y');
    }
    if (busIfaces.has('pwm')) {
      add('PWM driver', 'CONFIG_PWM=y');
    }
    if (busIfaces.has('adc')) {
      add('ADC driver', 'CONFIG_ADC=y');
    }
    if (busIfaces.has('can')) {
      add('CAN driver', 'CONFIG_CAN=y');
    }
    if (busIfaces.has('wifi')) {
      add('Wi-Fi + networking stack',
        'CONFIG_WIFI=y',
        'CONFIG_NETWORKING=y',
        'CONFIG_NET_IPV4=y',
        'CONFIG_NET_L2_WIFI_MGMT=y',
      );
    }
    if (busIfaces.has('mqtt')) {
      add('MQTT client',
        'CONFIG_MQTT_LIB=y',
        'CONFIG_NET_TCP=y',
      );
    }
    if (busIfaces.has('ble')) {
      add('Bluetooth LE',
        'CONFIG_BT=y',
        'CONFIG_BT_PERIPHERAL=y',
      );
    }
    if (busIfaces.has('ethernet')) {
      add('Ethernet',
        'CONFIG_NETWORKING=y',
        'CONFIG_NET_L2_ETHERNET=y',
      );
    }
    if (busIfaces.has('ota')) {
      add('OTA via MCUboot',
        'CONFIG_BOOTLOADER_MCUBOOT=y',
        'CONFIG_MCUBOOT_IMG_MANAGER=y',
      );
    }
    if (busIfaces.has('eeprom') || busIfaces.has('littlefs')) {
      add('Persistent storage', 'CONFIG_NVS=y');
    }

    lines.push('');
    return lines.join('\n');
  }
}
