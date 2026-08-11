/**
 * Pin allocation checking.
 *
 * Two devices wired to one pin is a mistake on every board, so this needs no
 * board profile to be useful. It is the cheapest thing a compiler can do that
 * hand-written firmware cannot: the C compiler is perfectly happy with
 * `digitalWrite(25, HIGH)` in two drivers, and the fault only shows up as an
 * actuator that twitches when the wrong thing runs.
 *
 * Board-specific rules - input-only pins, pins tied to flash, PWM channel
 * limits - need a verified board profile and come later.
 */

import type { PulseProject, Component, Resource } from '../model/index.js';

/** Binding keys that name a pin, per interface kind and per device type. */
const PIN_KEYS = ['pin', 'sda', 'scl', 'sck', 'miso', 'mosi', 'cs', 'rx', 'tx'];

export interface PinClaim {
  /** Normalised pin identity, e.g. "21" for GPIO21. */
  pin: string;
  /** How it was written in the model, e.g. "GPIO21". */
  written: string;
  /** Device or bus that claims it. */
  owner: string;
  kind: 'device' | 'bus';
  /** Binding key it came from, e.g. "sda". */
  role: string;
}

export interface PinConflict {
  pin: string;
  claims: PinClaim[];
}

/**
 * Normalise how a pin was written so `GPIO21`, `gpio_21` and `21` compare
 * equal. Anything that is not a recognised spelling is compared as-is, since
 * `A0` and `D4` are real, distinct board macros.
 */
export function normalizePin(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  const gpio = /^(?:GPIO|IO)[_-]?(\d+)$/i.exec(text);
  if (gpio) return gpio[1];

  if (/^\d+$/.test(text)) return text;

  return text.toUpperCase();
}

/** Every pin claimed by a device or a bus, in declaration order. */
export function collectPinClaims(project: PulseProject): PinClaim[] {
  const claims: PinClaim[] = [];

  const scan = (owner: string, kind: PinClaim['kind'], bag: Record<string, unknown> | undefined) => {
    if (!bag) return;
    for (const role of PIN_KEYS) {
      const pin = normalizePin(bag[role]);
      if (pin === null) continue;
      claims.push({ pin, written: String(bag[role]), owner, kind, role });
    }
  };

  for (const bus of (project.system.resources || []) as Resource[]) {
    scan(bus.name, 'bus', bus.binding);
  }
  for (const device of (project.system.components || []) as Component[]) {
    scan(device.name, 'device', device.config);
  }

  return claims;
}

/**
 * Pins claimed more than once.
 *
 * A device that sits on a bus legitimately shares the bus's pins, so a claim is
 * only a conflict between *independent* owners. `bus: sensor_bus` is how the
 * model says "these share deliberately".
 */
export function findPinConflicts(project: PulseProject): PinConflict[] {
  const busOf = new Map<string, string | undefined>(
    (project.system.components || []).map(c => [c.name, c.bus])
  );

  const byPin = new Map<string, PinClaim[]>();
  for (const claim of collectPinClaims(project)) {
    const list = byPin.get(claim.pin) || [];
    list.push(claim);
    byPin.set(claim.pin, list);
  }

  const conflicts: PinConflict[] = [];

  for (const [pin, claims] of byPin) {
    if (claims.length < 2) continue;

    // Collapse claims that are the same wiring seen twice: a device declaring
    // the bus it sits on, or one owner naming a pin under two roles.
    const independent = claims.filter(claim => {
      if (claim.kind !== 'device') return true;
      const bus = busOf.get(claim.owner);
      if (!bus) return true;
      // The device sits on a bus that also claims this pin - that is the point.
      return !claims.some(other => other.kind === 'bus' && other.owner === bus);
    });

    const owners = new Set(independent.map(c => c.owner));
    if (owners.size > 1) conflicts.push({ pin, claims: independent });
  }

  return conflicts;
}

/** A conflict, phrased so the fix is obvious. */
export function describePinConflict(conflict: PinConflict): string {
  const lines = conflict.claims.map(
    c => `    ${c.written} — ${c.kind} "${c.owner}" (${c.role})`
  );
  return `Pin ${conflict.pin} is claimed by ${conflict.claims.length} different things:\n${lines.join('\n')}`;
}
