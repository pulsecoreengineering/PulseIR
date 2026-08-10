/**
 * MQTT topic manifest emitter (IR → JSON)
 *
 * The second consumer of the IR, and the first that is not a code generator.
 * A dashboard subscribes to what the device publishes and publishes what the
 * device subscribes to; deriving both sides from one model means a renamed
 * sensor cannot silently blank a chart.
 *
 * Directions are named from the DEVICE's point of view, matching how firmware
 * reads: `publish` is what the device sends out, `subscribe` is what it
 * accepts. A dashboard swaps the two.
 *
 * Payloads are plain text scalars ("23.4", "idle") rather than JSON, so a
 * generic "read numeric value" widget can chart a topic with no parsing.
 *
 * Topic shape:
 *   <namespace>/{device}/<sensor>              sensor reading      (publish)
 *   <namespace>/{device}/state                 current leaf state  (publish)
 *   <namespace>/{device}/setpoint/<parameter>  writable tunable    (subscribe)
 *   <namespace>/{device}/event/<EVENT>         injected event      (subscribe)
 *
 * `{device}` stays a placeholder: one manifest describes a fleet, and the
 * firmware substitutes a per-device id at boot.
 */

import type { PulseProject, State } from '../model/index.js';

export class TopicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicError';
  }
}

export interface PublishTopic {
  topic: string;
  kind: 'sensor' | 'state';
  valueType: 'float' | 'string';
  /** Component this reading comes from (sensors only). */
  source?: string;
  driver?: string;
  unit?: string;
  /** Every value this topic can carry (state only). */
  values?: string[];
}

export interface SubscribeTopic {
  topic: string;
  kind: 'setpoint' | 'command';
  valueType: 'float' | 'int32' | 'bool' | 'string' | 'trigger';
  /** Parameter this writes (setpoints only). */
  parameter?: string;
  /** Event this raises (commands only). */
  event?: string;
  unit?: string;
  default?: unknown;
  min?: number;
  max?: number;
  description?: string;
}

export interface TopicManifest {
  schema: 'pulseir/topics@1';
  project: string;
  version: string;
  /** Topic prefix with a runtime placeholder for the device id. */
  prefix: string;
  payloadFormat: 'plain-text-scalar';
  /** Whose point of view `publish` and `subscribe` are written from. */
  perspective: 'device';
  publish: PublishTopic[];
  subscribe: SubscribeTopic[];
}

export class TopicEmitter {
  /**
   * Build the manifest. `namespace` defaults to the project name; pass your
   * own (e.g. "pulsecompiler") to match an existing deployment.
   */
  emit(project: PulseProject, namespace?: string): TopicManifest {
    const ns = this.segment(namespace || project.name, 'namespace');
    const prefix = `${ns}/{device}`;

    return {
      schema: 'pulseir/topics@1',
      project: project.name,
      version: String(project.version),
      prefix,
      payloadFormat: 'plain-text-scalar',
      perspective: 'device',
      publish: this.publishTopics(project, prefix),
      subscribe: this.subscribeTopics(project, prefix),
    };
  }

  toJSON(project: PulseProject, namespace?: string): string {
    return JSON.stringify(this.emit(project, namespace), null, 2) + '\n';
  }

  // =========================================================================

  private publishTopics(project: PulseProject, prefix: string): PublishTopic[] {
    const topics: PublishTopic[] = [];

    // One topic per sensor component. Readings are numeric, matching the
    // SystemSensors struct codegen generates from these same components.
    for (const component of project.system.components || []) {
      if (String(component.class) !== 'sensor') continue;

      const leaf = this.segment(component.name, 'sensor');
      const unit = component.config?.unit;

      topics.push({
        topic: `${prefix}/${leaf}`,
        kind: 'sensor',
        valueType: 'float',
        source: component.name,
        driver: component.driver,
        ...(typeof unit === 'string' ? { unit } : {}),
      });
    }

    // The machine only ever rests in a leaf state, so those are the only
    // values this topic can carry. A dashboard can drive an alert indicator
    // off it (e.g. value == "fault") without a separate topic.
    const leaves = this.leafPaths(project.system.states);
    if (leaves.length > 0) {
      topics.push({
        topic: `${prefix}/state`,
        kind: 'state',
        valueType: 'string',
        values: leaves,
      });
    }

    return topics;
  }

  private subscribeTopics(project: PulseProject, prefix: string): SubscribeTopic[] {
    const topics: SubscribeTopic[] = [];

    // Parameters are the writable tunables. The IR knows their type, unit and
    // range, which is what a dashboard needs to render a bounded control -
    // information a hand-written `float spTemp = 30.0;` throws away.
    for (const parameter of project.system.parameters || []) {
      const leaf = this.segment(parameter.name, 'parameter');

      topics.push({
        topic: `${prefix}/setpoint/${leaf}`,
        kind: 'setpoint',
        valueType: this.valueType(parameter.type),
        parameter: parameter.name,
        ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
        ...(parameter.default !== undefined ? { default: parameter.default } : {}),
        ...(parameter.min !== undefined ? { min: parameter.min } : {}),
        ...(parameter.max !== undefined ? { max: parameter.max } : {}),
        ...(parameter.description !== undefined ? { description: parameter.description } : {}),
      });
    }

    // Only events the model explicitly marks as arriving over MQTT. Exposing
    // every event would let a dashboard drive transitions the designer never
    // meant to be remotely triggerable.
    for (const event of project.system.events || []) {
      if (String(event.source) !== 'mqtt') continue;

      topics.push({
        topic: `${prefix}/event/${this.segment(event.name, 'event')}`,
        kind: 'command',
        valueType: 'trigger',
        event: event.name,
        ...(event.description !== undefined ? { description: event.description } : {}),
      });
    }

    return topics;
  }

  // =========================================================================

  /** Paths of states with no children - the only states the machine rests in. */
  private leafPaths(states: State[], prefix = ''): string[] {
    const paths: string[] = [];

    for (const state of states) {
      const path = prefix ? `${prefix}/${state.name}` : state.name;
      const children = (state.regions || []).flatMap(r => r.states);

      if (children.length === 0) {
        paths.push(path);
      } else {
        paths.push(...this.leafPaths(children, path));
      }
    }

    return paths;
  }

  private valueType(type: string): SubscribeTopic['valueType'] {
    switch (type) {
      case 'float': return 'float';
      case 'int': return 'int32';
      case 'bool': return 'bool';
      case 'string': return 'string';
      default:
        throw new TopicError(`Parameter has unsupported type "${type}"`);
    }
  }

  /**
   * MQTT reserves `+` and `#` as wildcards and `/` as the separator, so a name
   * carrying any of them would silently reshape the topic tree.
   */
  private segment(name: string, role: string): string {
    const cleaned = String(name)
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleaned) {
      throw new TopicError(`Cannot build a topic segment from ${role} name "${name}"`);
    }
    return cleaned;
  }
}

export { TopicEmitter as default };
