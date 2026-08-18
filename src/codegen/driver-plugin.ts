/**
 * Custom driver plugin support.
 *
 * A driver plugin is a YAML file that maps a driver: name to platform-specific
 * C++ code snippets. When PulseIR encounters an unknown driver: name it checks
 * the loaded plugins before emitting a TODO stub.
 *
 * Plugin YAML format:
 *
 *   driver: hcsr04_read
 *   description: HC-SR04 ultrasonic distance sensor
 *   platforms:
 *     arduino: |
 *       digitalWrite({trigger_pin}, LOW); delayMicroseconds(2);
 *       ...
 *     espidf: |
 *       gpio_set_level((gpio_num_t){trigger_pin}, 0); esp_rom_delay_us(2);
 *       ...
 *     default: |
 *       // TODO: implement {driver} for this platform
 *
 * Template variables — for every key in the action's params:
 *   {key}      → the param value (e.g. device name "trig")
 *   {key_pin}  → the generated pin macro (e.g. "TRIG_PIN")
 *   {driver}   → the driver name itself
 */

export interface DriverPlugin {
  driver: string;
  description?: string;
  /** Platform-keyed code snippets. "default" is the fallback. */
  platforms: Record<string, string>;
}

/**
 * Substitute template variables and indent the result for a C++ function body.
 */
export function resolvePluginBody(
  plugin: DriverPlugin,
  params: Record<string, unknown>,
  backendName: string
): string {
  const template = plugin.platforms[backendName] ?? plugin.platforms['default'];
  if (!template) {
    return `  // ${plugin.driver} — no template for backend "${backendName}"\n  (void)ctx;`;
  }

  let result = template.replace('{driver}', plugin.driver);

  for (const [key, value] of Object.entries(params)) {
    const strVal = String(value ?? '');
    const pinMacro = strVal.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_PIN';
    result = result.split(`{${key}_pin}`).join(pinMacro);
    result = result.split(`{${key}}`).join(strVal);
  }

  // Trim trailing newline then indent each line for a function body.
  return result
    .trimEnd()
    .split('\n')
    .map(line => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
}
