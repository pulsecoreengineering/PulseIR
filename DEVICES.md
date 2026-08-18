# PulseIR Device Reference

All device types recognised by PulseIR's code generator, their YAML configuration, the sensors/channels they expose, the drivers that operate them, and the Arduino libraries they require.

> **Multi-file note**: In real projects, hardware declarations live in their own file (typically `hardware.yaml`) and the entry file imports it with `imports: [hardware.yaml]`. Everything here applies identically whether you write it inline or split it out. See QUICKSTART.md → "Splitting a Model Across Files" for the import syntax.

---

## Table of Contents

1. [Primitive devices](#primitive-devices) — pin-owned, no external library
   - [digital_output](#digital_output)
   - [digital_input](#digital_input)
   - [pwm_output](#pwm_output)
   - [analog_input](#analog_input)
2. [Sensor devices](#sensor-devices) — library-backed, one object per device
   - [dht22 / dht11](#dht22--dht11)
   - [ds18b20](#ds18b20)
   - [bme280](#bme280)
3. [Real-time clocks](#real-time-clocks)
   - [ds3231](#ds3231)
   - [ds1307](#ds1307)
4. [Display devices](#display-devices)
   - [lcd_i2c](#lcd_i2c)
   - [oled_i2c](#oled_i2c)
5. [Driver reference](#driver-reference) — all `driver:` values and their params

---

## Primitive devices

Primitive devices own a single pin. PulseIR emits a `pinMode()` call for them; no external library is needed. Declare them directly under `hardware.devices:`.

### digital_output

Drives a digital pin HIGH, LOW, or toggles it.

```yaml
hardware:
  devices:
    led:
      type: digital_output
      pin: GPIO12
```

| Field | Required | Description |
|-------|----------|-------------|
| `pin` | yes | GPIO pin (e.g. `GPIO12`, `D4`, `2`) |

**Compatible drivers**: `gpio_control`

```yaml
actions:
  turn_on:
    driver: gpio_control
    params: { device: led, value: HIGH }

  toggle:
    driver: gpio_control
    params: { device: led, value: TOGGLE }
```

`value` accepts `HIGH`, `LOW`, or `TOGGLE`.

---

### digital_input

Reads a digital pin. Can also generate interrupts — see the `interrupt:` field.

```yaml
hardware:
  devices:
    button:
      type: digital_input
      pin: GPIO14
      pull: INPUT_PULLUP   # optional: INPUT, INPUT_PULLUP, INPUT_PULLDOWN
```

| Field | Required | Description |
|-------|----------|-------------|
| `pin` | yes | GPIO pin |
| `pull` | no | Pull resistor mode. Default: `INPUT` |
| `interrupt` | no | `rising`, `falling`, or `change` — wires an ISR that calls `fsm.sendEvent(…)` |

**Compatible drivers**: `gpio_read`

```yaml
actions:
  sample_button:
    driver: gpio_read
    params: { device: button, into: systemSensors.button_state }
```

**With interrupt**:

```yaml
hardware:
  devices:
    motion:
      type: digital_input
      pin: GPIO14
      interrupt: rising
```

PulseIR generates the ISR and `attachInterrupt()` call automatically. The interrupt fires `EVENT_MOTION_DETECTED` — the event name is derived from the device name.

---

### pwm_output

Controls duty cycle via `ledcWrite` (ESP32) or `analogWrite` (Arduino Uno).

```yaml
hardware:
  devices:
    fan:
      type: pwm_output
      pin: GPIO27
      channel: 0     # ESP32 LEDC channel (0–15)
```

| Field | Required | Description |
|-------|----------|-------------|
| `pin` | yes | GPIO pin |
| `channel` | ESP32 only | LEDC channel (0–15) |

**Compatible drivers**: `pwm_control`

```yaml
actions:
  set_fan_speed:
    driver: pwm_control
    params: { device: fan, duty: 128 }   # 0–255
```

---

### analog_input

Reads an ADC channel.

```yaml
hardware:
  devices:
    pot:
      type: analog_input
      pin: GPIO34
```

| Field | Required | Description |
|-------|----------|-------------|
| `pin` | yes | ADC-capable pin |

**Compatible drivers**: `adc_read`

```yaml
actions:
  read_pot:
    driver: adc_read
    params: { device: pot, into: systemSensors.pot_value }
```

---

## Sensor devices

These devices attach to a bus or a dedicated data pin. PulseIR emits the `#include`, the object declaration, and the `begin()` call. You install the named library via the Arduino Library Manager (or PlatformIO's `lib_deps`).

### dht22 / dht11

Temperature and relative humidity sensor. Both use Adafruit's DHT library; the only difference is the constructor argument (`DHT22` vs `DHT11`).

```yaml
hardware:
  devices:
    weather:
      type: dht22
      pin: GPIO4
      channels: [temperature, humidity]
```

| Field | Required | Description |
|-------|----------|-------------|
| `pin` | yes | Single-wire data pin |
| `channels` | no | Names exposed in `{device.channel}` refs |

**Library**: `DHT sensor library` (Adafruit) — install via Arduino Library Manager.

**Compatible drivers**: `dht22`, `dht11`, `dht_read`

`dht_read` is an alias that looks up the device's actual type and dispatches accordingly, so you can write `driver: dht_read` regardless of which variant is wired.

```yaml
actions:
  read_climate:
    driver: dht_read
    params:
      device: weather
      measure: [temperature, humidity]   # omit to read both
```

`measure` can be a single string (`temperature` or `humidity`) or a list.

**Generated sensors** (written to `systemSensors`): `temperature` (°C, float), `humidity` (%, float).

---

### ds18b20

One-Wire temperature sensor. Sits on a OneWire bus resource.

```yaml
hardware:
  buses:
    sensor_bus:
      interface: onewire
      pin: GPIO4

  devices:
    water_temp:
      type: ds18b20
      bus: sensor_bus
      unit: degC
```

| Field | Required | Description |
|-------|----------|-------------|
| `bus` | yes | Name of a `onewire` bus resource |
| `unit` | no | Informational; does not affect generated code |

**Library**: `DallasTemperature` — install via Arduino Library Manager.

**Compatible drivers**: `ds18b20`

```yaml
actions:
  read_temp:
    driver: ds18b20
    params: { device: water_temp }
```

Generated code calls `water_temp.requestTemperatures()` then `getTemp…()` and writes the result to `systemSensors.water_temp`.

---

### bme280

Environmental sensor measuring temperature, humidity, and barometric pressure.

```yaml
hardware:
  buses:
    i2c_bus:
      interface: i2c
      sda: GPIO21
      scl: GPIO22

  devices:
    env:
      type: bme280
      bus: i2c_bus
      address: 0x76   # or 0x77 depending on SDO pin
```

| Field | Required | Description |
|-------|----------|-------------|
| `bus` | yes | Name of an `i2c` bus resource |
| `address` | no | I2C address. Default: `0x76` |

**Library**: `Adafruit BME280 Library` — install via Arduino Library Manager. Also requires `Adafruit Unified Sensor`.

**Compatible drivers**: `bme280`

```yaml
actions:
  read_env:
    driver: bme280
    params:
      device: env
      measure: temperature   # temperature | humidity | pressure
```

`measure` defaults to `temperature`. Use a list to read multiple values in one action:

```yaml
  read_all:
    driver: bme280
    params:
      device: env
      measure: [temperature, humidity, pressure]
```

Pressure is written in hPa (divided by 100 from the raw Pa value).

---

## Real-time clocks

RTC devices share the I2C bus and use the RTClib library. Both DS3231 and DS1307 use the same driver (`rtc_read`) with the same channel names.

### ds3231

High-accuracy RTC with temperature-compensated crystal.

```yaml
hardware:
  buses:
    i2c_bus:
      interface: i2c
      sda: GPIO21
      scl: GPIO22

  devices:
    clock:
      type: ds3231
      bus: i2c_bus
      channels: [hour, minute, second, day, month, year]
```

| Field | Required | Description |
|-------|----------|-------------|
| `bus` | yes | Name of an `i2c` bus resource |
| `channels` | no | Names exposed in `{device.channel}` LCD format refs |

**Library**: `RTClib` (Adafruit) — install via Arduino Library Manager.

No `address` field — RTClib hardcodes the DS3231 address.

---

### ds1307

Lower-cost RTC without temperature compensation.

```yaml
  devices:
    clock:
      type: ds1307
      bus: i2c_bus
      channels: [hour, minute, second]
```

Same config as ds3231. Uses `RTC_DS1307` class from RTClib.

**Compatible drivers** (both): `rtc_read`

```yaml
actions:
  read_time:
    driver: rtc_read
    params:
      device: clock
      # no `measure` needed — reads all declared channels automatically
```

Available channel names: `hour`, `minute`, `second`, `day`, `month`, `year`, `dayOfWeek`.

---

## Display devices

### lcd_i2c

I2C character LCD (PCF8574 backpack). Uses the LiquidCrystal_I2C library.

```yaml
hardware:
  devices:
    screen:
      type: lcd_i2c
      bus: i2c_bus
      address: 0x27
      cols: 16
      rows: 2
```

| Field | Required | Description |
|-------|----------|-------------|
| `bus` | yes | Name of an `i2c` bus resource |
| `address` | yes | I2C address. Common values: `0x27`, `0x3F` |
| `cols` | yes | Number of columns (e.g. `16`, `20`) |
| `rows` | yes | Number of rows (e.g. `2`, `4`) |

**Library**: `LiquidCrystal_I2C` — install via Arduino Library Manager.

**Compatible drivers**: `lcd_display`, `lcd_print`, `lcd_clear`

**Displaying formatted text**:

```yaml
actions:
  update_display:
    driver: lcd_display
    params:
      device: screen
      clear: true                  # call display.clear() before writing
      lines:
        - format: "Temp: {env.temperature} C"
          row: 0
          col: 0
        - format: "Hum:  {env.humidity} %"
          row: 1
          col: 0
```

The `{device.channel}` syntax in `format:` resolves to a sensor value at runtime:
- **RTC channels** (`hour`, `minute`, `second`, etc.) are zero-padded integers: `display.print('0')` guard + `display.print((int)val)`.
- **Float sensors** use `display.print(val, 1)` — one decimal place, works on all boards including AVR (Arduino Uno).

**Clearing the screen**:

```yaml
actions:
  clear_screen:
    driver: lcd_clear
    params: { device: screen }
```

**Raw text** (no format refs):

```yaml
actions:
  show_ready:
    driver: lcd_print
    params:
      device: screen
      text: "Ready"
      row: 0
      col: 0
```

---

### oled_i2c

I2C OLED display (SSD1306 controller). Uses the Adafruit SSD1306 library.

```yaml
hardware:
  devices:
    oled:
      type: oled_i2c
      bus: i2c_bus
      address: 0x3C
      width: 128
      height: 64
```

| Field | Required | Description |
|-------|----------|-------------|
| `bus` | yes | Name of an `i2c` bus resource |
| `address` | yes | I2C address. Common values: `0x3C`, `0x3D` |
| `width` | yes | Display width in pixels (e.g. `128`) |
| `height` | yes | Display height in pixels (e.g. `32`, `64`) |

**Library**: `Adafruit SSD1306` — install via Arduino Library Manager. Also requires `Adafruit GFX Library`.

**Compatible drivers**: `oled_print`

```yaml
actions:
  show_status:
    driver: oled_print
    params:
      device: oled
      text: "Running"
      x: 0
      y: 0
      size: 1     # text size multiplier (1 = 6×8 px per char)
```

---

## Driver reference

Complete list of all `driver:` values and their `params:`.

| Driver | Purpose | Key params |
|--------|---------|------------|
| `gpio_control` | Set a digital output | `device`, `value` (`HIGH`/`LOW`/`TOGGLE`) |
| `gpio_read` | Read a digital input | `device`, `into` |
| `adc_read` | Read an analog input | `device`, `into` |
| `pwm_control` | Set PWM duty cycle | `device`, `duty` (0–255) |
| `dht_read` | Read DHT22 or DHT11 | `device`, `measure` |
| `dht22` | Read DHT22 specifically | `device`, `measure` |
| `dht11` | Read DHT11 specifically | `device`, `measure` |
| `ds18b20` | Read DS18B20 | `device` |
| `bme280` | Read BME280 | `device`, `measure` |
| `rtc_read` | Read RTC channels | `device` |
| `lcd_display` | Formatted LCD write | `device`, `lines`, `clear` |
| `lcd_print` | Raw LCD text | `device`, `text`, `row`, `col` |
| `lcd_clear` | Clear LCD | `device` |
| `oled_print` | OLED text | `device`, `text`, `x`, `y`, `size` |
| `sleep_control` | Enter deep sleep | `mode` (`deep_sleep`/`light_sleep`), `duration_us` |
| `http_get` | HTTP GET request | `url`, `into` |
| `http_post` | HTTP POST request | `url`, `body`, `content_type` |
| `console_help` | Print serial help | *(no params)* |

### Sensor channels and `systemSensors`

Every sensor read action writes its result into the `SystemSensors` struct generated from the model. The field name is the device name (sanitised to a C identifier). For example:

```yaml
hardware:
  devices:
    water_temp:   { type: ds18b20, bus: sensor_bus }
    env:          { type: bme280, bus: i2c_bus }
```

Produces:

```cpp
struct SystemSensors {
  float water_temp;
  float env;        // temperature (default measure)
  // ... other declared sensors
};
```

Guards and actions read these through `ctx->sensors->water_temp`.

### The `{device.channel}` syntax in LCD format strings

LCD `format:` strings can reference sensor channels by name:

```
{device_name.channel_name}
```

- `device_name` must match a device declared under `hardware.devices:`
- `channel_name` must appear in that device's `channels:` list
- The dot is required; bare `{name}` looks up `systemSensors.name` directly

RTC channel names (`hour`, `minute`, `second`, `day`, `month`, `year`, `dayOfWeek`) are automatically zero-padded.

---

## Library quick-reference

| Device type | Library (Arduino Library Manager name) |
|-------------|---------------------------------------|
| `dht22`, `dht11` | DHT sensor library |
| `ds18b20` | DallasTemperature |
| `bme280` | Adafruit BME280 Library |
| `ds3231`, `ds1307` | RTClib |
| `lcd_i2c` | LiquidCrystal_I2C |
| `oled_i2c` | Adafruit SSD1306 |

Generated code includes a `// Requires:` comment listing every library the model needs. The CLI also prints the install list when run.
