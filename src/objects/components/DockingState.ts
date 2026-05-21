/**
 * @fileoverview Docking State
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * DockingState — docking state of an entity.
 *
 * Port of DockingController.fromTagStructure() Java.
 *
 * Structure Tag (DockingController.toTagStructure) :
 *   STRUCT [
 *     [0] STRING  dockedTo ("NONE" when free)
 *     [1] VECTOR3i dockingPos  (docking module position)
 *     [2] VECTOR3i dockSize    (unused dimensionflex)
 *     [3] VECTOR3f dockingPosRelative
 *     [4] VECTOR3f "s" size
 *     [5] BYTE    dockLocalOrientation
 *     [6] VECTOR4f localDockingOrientation (quaternion)
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';

/**
 * Represents the DockingState model used by high-level entity component modelling.
 */
export class DockingState {
  /** "NONE" = undocked entity */
  static readonly NONE = 'NONE';

  /**
   * Creates a DockingState instance.
   *
   * @param dockedTo - Input value for the constructor operation.
   * @param dockPosX - Input value for the constructor operation.
   * @param dockPosY - Input value for the constructor operation.
   * @param dockPosZ - Input value for the constructor operation.
   * @param sizeX - Input value for the constructor operation.
   * @param sizeY - Input value for the constructor operation.
   * @param sizeZ - Input value for the constructor operation.
   * @param localOrientation - Input value for the constructor operation.
   */
  constructor(
    /** host entity UID ("NONE" when free) */
    readonly dockedTo: string,
    /** Docking module position in block coordinates */
    readonly dockPosX: number,
    readonly dockPosY: number,
    readonly dockPosZ: number,
    /** Docking area size */
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
    /** Orientation locale (byte 0-23) */
    readonly localOrientation: number,
  ) {}

  static UNDOCKED = new DockingState(DockingState.NONE, 0, 0, 0, 0, 0, 0, 0);

  /**
   * Reports whether isDocked is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isDocked(): boolean { return this.dockedTo !== DockingState.NONE && this.dockedTo !== ''; }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): DockingState {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const dockedTo    = s[0]?.type === TagType.STRING   ? s[0].getString()   : DockingState.NONE;
    const dockPos     = s[1]?.type === TagType.VECTOR3i ? s[1].getVector3i() : null;
    const orient      = s[5]?.type === TagType.BYTE     ? s[5].getByte()     : 0;
    const sizeTag     = s.find(t => t.name === 's' && t.type === TagType.VECTOR3f);
    const size        = sizeTag?.getVector3f() ?? null;

    return new DockingState(
      dockedTo,
      dockPos?.x ?? 0, dockPos?.y ?? 0, dockPos?.z ?? 0,
      size?.x ?? 0, size?.y ?? 0, size?.z ?? 0,
      orient,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const children: Tag[] = [
      Tags.string(null, this.dockedTo),
      Tags.vector3i(null, this.dockPosX, this.dockPosY, this.dockPosZ),
      Tags.vector3i(null, 0, 0, 0),  // dockSize placeholder
      Tags.vector3f(null, 0, 0, 0),  // dockingPosRelative placeholder
      Tags.vector3f('s', this.sizeX, this.sizeY, this.sizeZ),
      Tags.byte(null, this.localOrientation),
    ];
    return Tags.struct(null, children);
  }

  /**
   * Handles the undock operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  undock(): DockingState {
    return new DockingState(DockingState.NONE, 0, 0, 0, this.sizeX, this.sizeY, this.sizeZ, 0);
  }

  /**
   * Handles the dockTo operation used by high-level entity component modelling.
   *
   * @param entityUID - Input value for the dockTo operation.
   * @param posX - Input value for the dockTo operation.
   * @param posY - Input value for the dockTo operation.
   * @param posZ - Input value for the dockTo operation.
   * @param orient - Input value for the dockTo operation.
   * @returns The computed StarMade-Decoder value.
   */
  dockTo(entityUID: string, posX: number, posY: number, posZ: number, orient = 0): DockingState {
    return new DockingState(entityUID, posX, posY, posZ, this.sizeX, this.sizeY, this.sizeZ, orient);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    if (!this.isDocked) return 'DockingState(UNDOCKED)';
    return `DockingState(dockedTo="${this.dockedTo}", pos=(${this.dockPosX},${this.dockPosY},${this.dockPosZ}))`;
  }
}
