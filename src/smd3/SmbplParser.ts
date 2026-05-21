/**
 * @fileoverview SMBpl Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbplParser — parser for .smbpl files (blueprint logic / connections).
 *
 * Format (BlueprintEntry.readStructure) :
 *   int   structureVersion   (currently always 0)
 *   [data ControlElementMap.deserialize]
 *     Same format as factory id=0 (ControlElementMapper) :
 *     int header (negative)
 *     int keySize
 *     for each key : 3×short pos + int valueSize + (short type + int elemSize + elemSize×3×short)
 *
 * For empty files (size = 0 or only the int version): no connection.
 *
 * Java source: BlueprintEntry.readStructure()
 */

import { BufferReader } from '../core/BufferReader.js';
import type { BlockPosition } from '../objects/ElementPosition.js';

/**
 * Describes the ControlLink data shape used by StarMade blueprint and segment file parsing.
 */
export interface ControlLink {
  /** Controller block position (local to the segment) */
  fromX: number; fromY: number; fromZ: number;
  /** Controlled block type */
  type: number;
  /** Controlled block positions */
  targets: Array<{ x: number; y: number; z: number }>;
}

/**
 * Describes the ControlGroup data shape used by StarMade blueprint and segment file parsing.
 */
export interface ControlGroup {
  /** Controlled block type. */
  type: number;
  /** Controlled block positions. */
  targets: Array<{ x: number; y: number; z: number }>;
}

/**
 * Describes the ControlController data shape used by StarMade blueprint and segment file parsing.
 */
export interface ControlController {
  /** Controller block position (local to the segment). */
  x: number; y: number; z: number;
  /** Control groups keyed by controlled block type. */
  groups: ControlGroup[];
}

/**
 * Describes the SmbplFile data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmbplFile {
  structureVersion: number;
  /** High-level ControlElementMap structure, preserving empty controllers. */
  controllers: ControlController[];
  /** Control links (ControlElementMap) */
  links: ControlLink[];
  /** Controller block count */
  controllerCount: number;
}

/**
 * Represents the BlueprintLogic model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintLogic implements SmbplFile {
  structureVersion: number;
  controllers: ControlController[];
  links: ControlLink[];
  controllerCount: number;

  /**
   * Creates a BlueprintLogic instance.
   *
   * @param input - Input value for the constructor operation.
   */
  constructor(input: SmbplFile) {
    this.structureVersion = input.structureVersion;
    this.controllers = input.controllers.length > 0
      ? cloneControllers(input.controllers)
      : controllersFromLinks(input.links);
    this.links = linksFromControllers(this.controllers);
    this.controllerCount = this.controllers.length;
  }

  /**
   * Reports whether isEmpty is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isEmpty(): boolean {
    return this.controllers.length === 0;
  }

  /**
   * Handles the groupCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get groupCount(): number {
    return this.controllers.reduce((sum, controller) => sum + controller.groups.length, 0);
  }

  /**
   * Handles the connectionCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get connectionCount(): number {
    return this.links.reduce((sum, link) => sum + link.targets.length, 0);
  }

  /**
   * Handles the controllerAt operation used by StarMade blueprint and segment file parsing.
   *
   * @param position - Input value for the controllerAt operation.
   * @returns The computed StarMade-Decoder value.
   */
  controllerAt(position: BlockPosition): ControlController | null {
    return this.controllers.find(controller => samePosition(controller, position)) ?? null;
  }

  /**
   * Handles the groupsForType operation used by StarMade blueprint and segment file parsing.
   *
   * @param type - Input value for the groupsForType operation.
   * @returns The computed StarMade-Decoder value.
   */
  groupsForType(type: number): Array<{ controller: ControlController; group: ControlGroup }> {
    const matches: Array<{ controller: ControlController; group: ControlGroup }> = [];
    for (const controller of this.controllers) {
      for (const group of controller.groups) {
        if (group.type === type) {
          matches.push({ controller, group });
        }
      }
    }
    return matches;
  }

  /**
   * Handles the controllersForType operation used by StarMade blueprint and segment file parsing.
   *
   * @param type - Input value for the controllersForType operation.
   * @returns The computed StarMade-Decoder value.
   */
  controllersForType(type: number): ControlController[] {
    return this.groupsForType(type).map(match => match.controller);
  }

  /**
   * Handles the linksFrom operation used by StarMade blueprint and segment file parsing.
   *
   * @param position - Input value for the linksFrom operation.
   * @returns The computed StarMade-Decoder value.
   */
  linksFrom(position: BlockPosition): ControlLink[] {
    return this.links.filter(link => link.fromX === position.x && link.fromY === position.y && link.fromZ === position.z);
  }

  /**
   * Handles the targetsOf operation used by StarMade blueprint and segment file parsing.
   *
   * @param position - Input value for the targetsOf operation.
   * @param type - Input value for the targetsOf operation.
   * @returns The computed StarMade-Decoder value.
   */
  targetsOf(position: BlockPosition, type?: number): BlockPosition[] {
    return this.linksFrom(position)
      .filter(link => type === undefined || link.type === type)
      .flatMap(link => link.targets.map(target => ({ ...target })));
  }

  /**
   * Handles the typesFrom operation used by StarMade blueprint and segment file parsing.
   *
   * @param position - Input value for the typesFrom operation.
   * @returns The computed StarMade-Decoder value.
   */
  typesFrom(position: BlockPosition): number[] {
    return this.linksFrom(position).map(link => link.type);
  }

  /**
   * Reports whether isLinked is true for the current value.
   *
   * @param from - Input value for the isLinked operation.
   * @param target - Input value for the isLinked operation.
   * @param type - Input value for the isLinked operation.
   * @returns The computed StarMade-Decoder value.
   */
  isLinked(from: BlockPosition, target: BlockPosition, type?: number): boolean {
    return this.linksFrom(from).some(link =>
      (type === undefined || link.type === type) &&
      link.targets.some(t => samePosition(t, target))
    );
  }

  /**
   * Returns a copy updated with StructureVersion.
   *
   * @param structureVersion - Input value for the withStructureVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withStructureVersion(structureVersion: number): BlueprintLogic {
    return new BlueprintLogic({ ...this, structureVersion });
  }

  /**
   * Returns a copy updated with Controllers.
   *
   * @param controllers - Input value for the withControllers operation.
   * @returns The computed StarMade-Decoder value.
   */
  withControllers(controllers: ControlController[]): BlueprintLogic {
    return new BlueprintLogic({
      structureVersion: this.structureVersion,
      controllers,
      links: [],
      controllerCount: controllers.length,
    });
  }

  /**
   * Returns a copy updated with Links.
   *
   * @param links - Input value for the withLinks operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLinks(links: ControlLink[]): BlueprintLogic {
    const controllers = controllersFromLinks(links);
    return new BlueprintLogic({
      structureVersion: this.structureVersion,
      controllers,
      links,
      controllerCount: controllers.length,
    });
  }

  /**
   * Handles the addLink operation used by StarMade blueprint and segment file parsing.
   *
   * @param from - Input value for the addLink operation.
   * @param type - Input value for the addLink operation.
   * @param targets - Input value for the addLink operation.
   * @returns The computed StarMade-Decoder value.
   */
  addLink(from: BlockPosition, type: number, targets: BlockPosition | BlockPosition[]): BlueprintLogic {
    const nextTargets = Array.isArray(targets) ? targets : [targets];
    const controllers = cloneControllers(this.controllers);
    let controller = controllers.find(c => samePosition(c, from));
    if (!controller) {
      controller = { x: from.x, y: from.y, z: from.z, groups: [] };
      controllers.push(controller);
    }

    let group = controller.groups.find(g => g.type === type);
    if (!group) {
      group = { type, targets: [] };
      controller.groups.push(group);
    }

    for (const target of nextTargets) {
      if (!group.targets.some(existing => samePosition(existing, target))) {
        group.targets.push({ ...target });
      }
    }

    return this.withControllers(controllers);
  }

  /**
   * Handles the removeLink operation used by StarMade blueprint and segment file parsing.
   *
   * @param from - Input value for the removeLink operation.
   * @param type - Input value for the removeLink operation.
   * @param target - Input value for the removeLink operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeLink(from: BlockPosition, type?: number, target?: BlockPosition): BlueprintLogic {
    const controllers = cloneControllers(this.controllers);
    const controllerIndex = controllers.findIndex(controller => samePosition(controller, from));
    if (controllerIndex < 0) {
      return this;
    }

    if (type === undefined) {
      controllers.splice(controllerIndex, 1);
      return this.withControllers(controllers);
    }

    const controller = controllers[controllerIndex];
    const groupIndex = controller.groups.findIndex(group => group.type === type);
    if (groupIndex < 0) {
      return this;
    }

    if (!target) {
      controller.groups.splice(groupIndex, 1);
    } else {
      const group = controller.groups[groupIndex];
      group.targets = group.targets.filter(t => !samePosition(t, target));
      if (group.targets.length === 0) {
        controller.groups.splice(groupIndex, 1);
      }
    }

    if (controller.groups.length === 0) {
      controllers.splice(controllerIndex, 1);
    }

    return this.withControllers(controllers);
  }

  /**
   * Handles the clearController operation used by StarMade blueprint and segment file parsing.
   *
   * @param position - Input value for the clearController operation.
   * @returns The computed StarMade-Decoder value.
   */
  clearController(position: BlockPosition): BlueprintLogic {
    return this.removeLink(position);
  }

  /**
   * Handles the moveController operation used by StarMade blueprint and segment file parsing.
   *
   * @param from - Input value for the moveController operation.
   * @param to - Input value for the moveController operation.
   * @returns The computed StarMade-Decoder value.
   */
  moveController(from: BlockPosition, to: BlockPosition): BlueprintLogic {
    const controllers = cloneControllers(this.controllers);
    const controller = controllers.find(c => samePosition(c, from));
    if (!controller) {
      return this;
    }
    controller.x = to.x;
    controller.y = to.y;
    controller.z = to.z;
    return this.withControllers(controllers);
  }
}

/**
 * Parses Smbpl for StarMade blueprint and segment file parsing.
 *
 * @param data - Input value for the parseSmbpl operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSmbpl(data: Buffer | Uint8Array): BlueprintLogic {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result: SmbplFile = { structureVersion: 0, controllers: [], links: [], controllerCount: 0 };

  if (buf.length < 4) return new BlueprintLogic(result);

  const r = BufferReader.from(buf);
  result.structureVersion = r.readInt32BE();

  if (r.isEOF()) return new BlueprintLogic(result);

  // ControlElementMap.deserialize — port of factory id=0 parser
  try {
    const header = r.readInt32BE(); // negative
    if (header >= 0) {
      // Very old format without versioning (shift=8), cannot be parsed without context
      return new BlueprintLogic(result);
    }

    const version = -header;
    const isDisk = version > 1024;
    const keySize = r.readInt32BE();

    result.controllerCount = keySize;

    for (let i = 0; i < keySize; i++) {
      const fromX = r.readInt16BE();
      const fromY = r.readInt16BE();
      const fromZ = r.readInt16BE();

      const valueSize = r.readInt32BE();
      const controller: ControlController = { x: fromX, y: fromY, z: fromZ, groups: [] };

      for (let v = 0; v < valueSize; v++) {
        const type = r.readInt16BE();
        const elemSize = r.readInt32BE();

        const targets: Array<{ x: number; y: number; z: number }> = [];

        if (isDisk) {
          // serializeForDisk : 3×short per element
          for (let e = 0; e < elemSize; e++) {
            const tx = r.readInt16BE();
            const ty = r.readInt16BE();
            const tz = r.readInt16BE();
            targets.push({ x: tx, y: ty, z: tz });
          }
        } else {
          // network format : compressed
          const bigX = r.readInt8() !== 0;
          const bigY = r.readInt8() !== 0;
          const bigZ = r.readInt8() !== 0;
          const mX = r.readInt16BE(), mY = r.readInt16BE(), mZ = r.readInt16BE();
          for (let e = 0; e < elemSize; e++) {
            const tx = (bigX ? r.readInt16BE() : r.readInt8()) + mX;
            const ty = (bigY ? r.readInt16BE() : r.readInt8()) + mY;
            const tz = (bigZ ? r.readInt16BE() : r.readInt8()) + mZ;
            targets.push({ x: tx, y: ty, z: tz });
          }
        }

        controller.groups.push({ type, targets });
        result.links.push({ fromX, fromY, fromZ, type, targets });
      }
      result.controllers.push(controller);
    }
  } catch { /* unknown or truncated format */ }

  return new BlueprintLogic(result);
}

/**
 * Handles the cloneControllers operation used by StarMade blueprint and segment file parsing.
 *
 * @param controllers - Input value for the cloneControllers operation.
 * @returns The computed StarMade-Decoder value.
 */
function cloneControllers(controllers: ControlController[]): ControlController[] {
  return controllers.map(controller => ({
    x: controller.x,
    y: controller.y,
    z: controller.z,
    groups: controller.groups.map(group => ({
      type: group.type,
      targets: group.targets.map(target => ({ ...target })),
    })),
  }));
}

/**
 * Handles the controllersFromLinks operation used by StarMade blueprint and segment file parsing.
 *
 * @param links - Input value for the controllersFromLinks operation.
 * @returns The computed StarMade-Decoder value.
 */
function controllersFromLinks(links: ControlLink[]): ControlController[] {
  const byController = new Map<string, ControlController>();

  for (const link of links) {
    const key = positionKey({ x: link.fromX, y: link.fromY, z: link.fromZ });
    let controller = byController.get(key);
    if (!controller) {
      controller = { x: link.fromX, y: link.fromY, z: link.fromZ, groups: [] };
      byController.set(key, controller);
    }
    controller.groups.push({
      type: link.type,
      targets: link.targets.map(target => ({ ...target })),
    });
  }

  return [...byController.values()];
}

/**
 * Handles the linksFromControllers operation used by StarMade blueprint and segment file parsing.
 *
 * @param controllers - Input value for the linksFromControllers operation.
 * @returns The computed StarMade-Decoder value.
 */
function linksFromControllers(controllers: ControlController[]): ControlLink[] {
  return controllers.flatMap(controller =>
    controller.groups.map(group => ({
      fromX: controller.x,
      fromY: controller.y,
      fromZ: controller.z,
      type: group.type,
      targets: group.targets.map(target => ({ ...target })),
    }))
  );
}

/**
 * Handles the samePosition operation used by StarMade blueprint and segment file parsing.
 *
 * @param left - Input value for the samePosition operation.
 * @param right - Input value for the samePosition operation.
 * @returns The computed StarMade-Decoder value.
 */
function samePosition(left: BlockPosition, right: BlockPosition): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

/**
 * Handles the positionKey operation used by StarMade blueprint and segment file parsing.
 *
 * @param position - Input value for the positionKey operation.
 * @returns The computed StarMade-Decoder value.
 */
function positionKey(position: BlockPosition): string {
  return `${position.x},${position.y},${position.z}`;
}
