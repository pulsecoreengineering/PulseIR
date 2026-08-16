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

import type { PulseProject } from '../model/index.js';
import { leafPaths } from '../analysis/states.js';

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
    const comm = project.system.communication;

    if (comm?.publish !== undefined) {
      // Explicit communication block: only the listed sensors, with stable topic names.
      const componentMap = new Map(
        (project.system.components || []).map(c => [c.name, c])
      );
      for (const item of comm.publish) {
        const component = componentMap.get(item.sensor);
        if (!component) continue; // parser already validated
        const leaf = this.segment(item.topic ?? item.sensor, 'sensor');
        const unit = component.config?.unit;
        topics.push({
          topic: `${prefix}/${leaf}`,
          kind: 'sensor',
          valueType: 'float',
          source: item.sensor,
          driver: component.driver,
          ...(typeof unit === 'string' ? { unit } : {}),
        });
      }
    } else {
      // Implicit: all sensor components publish.
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
    }

    // The machine only ever rests in a leaf state, so those are the only
    // values this topic can carry. A dashboard can drive an alert indicator
    // off it (e.g. value == "fault") without a separate topic.
    const leaves = leafPaths(project.system.states);
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
    const comm = project.system.communication;

    if (comm?.subscribe !== undefined) {
      // Explicit communication block: only listed items, with stable topic names.
      const paramMap = new Map((project.system.parameters || []).map(p => [p.name, p]));
      const eventMap = new Map((project.system.events || []).map(e => [e.name, e]));

      for (const item of comm.subscribe) {
        if (item.parameter !== undefined) {
          const parameter = paramMap.get(item.parameter);
          if (!parameter) continue;
          const leaf = this.segment(item.topic ?? item.parameter, 'parameter');
          topics.push({
            topic: `${prefix}/setpoint/${leaf}`,
            kind: 'setpoint',
            valueType: this.valueType(parameter.type),
            parameter: item.parameter,
            ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
            ...(parameter.default !== undefined ? { default: parameter.default } : {}),
            ...(parameter.min !== undefined ? { min: parameter.min } : {}),
            ...(parameter.max !== undefined ? { max: parameter.max } : {}),
            ...(parameter.description !== undefined ? { description: parameter.description } : {}),
          });
        } else if (item.event !== undefined) {
          const event = eventMap.get(item.event);
          if (!event) continue;
          topics.push({
            topic: `${prefix}/event/${this.segment(item.topic ?? item.event, 'event')}`,
            kind: 'command',
            valueType: 'trigger',
            event: item.event,
            ...(event.description !== undefined ? { description: event.description } : {}),
          });
        }
      }
    } else {
      // Implicit: all parameters subscribe as setpoints; mqtt-sourced events subscribe.
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

      // Only events explicitly marked as MQTT-sourced. Exposing every event
      // would let a dashboard trigger transitions the designer never intended.
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
    }

    return topics;
  }

  // =========================================================================

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
