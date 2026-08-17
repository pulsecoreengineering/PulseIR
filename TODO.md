# PulseIR — Zephyr Backend Backlog

## Phase 5 — HTTP TCP socket wiring
- `httpGetLines` / `httpPostLines` scaffold `http_client_req()` but the TCP socket is never opened.
- Need `zsock_socket() → zsock_connect()` before the `http_client_req()` call and `zsock_close()` after.
- Also: split host from path in the URL so `_http_req.host` and `_http_req.url` are set correctly.

## Phase 5 — Bus interface implementations (`zephyr_interfaces.ts`)
All of these still emit `/* TODO */` stubs and need real Zephyr driver code:
- **UART** — device channel setup + `uart_poll_in` / `uart_poll_out` wiring
- **I2C** — `i2c_dt_spec` + `i2c_write_dt` / `i2c_read_dt`
- **SPI** — `spi_dt_spec` + `spi_transceive_dt`
- **BLE** — BT stack init + advertising / connection callbacks
- **CAN** — `can_dt_spec` + `can_send` / `can_add_rx_filter`
- **Ethernet** — net_if bring-up beyond the WiFi path
- **OTA** — MCUboot / DFU-over-UART or DFU-over-USB stubs
- **EEPROM / LittleFS** — `eeprom_dt_spec` + LittleFS mount

## Phase 6 — ADC async read
- Current `adc_read_dt()` is synchronous/blocking.
- Future: `adc_read_async()` + completion callback to avoid blocking the workqueue.

## Design limitation (by design, low priority)
- Tasks whose interval comes from a `systemParameters.*` value use the polling loop instead of `k_timer`.
  `k_timer_start()` takes a fixed value at setup time and cannot track runtime parameter changes.
  No action needed unless the polling overhead becomes a problem.
