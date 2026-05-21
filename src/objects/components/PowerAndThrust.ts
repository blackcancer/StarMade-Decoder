/**
 * @fileoverview Power And Thrust
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PowerState — power state of an entity (ship, station).
 *
 * Port of PowerAddOn.fromTagStructure() Java.
 *
 * Structure Tag :
 *   STRUCT [
 *     [0] DOUBLE initialPower
 *     [1] DOUBLE initialBatteryPower
 *     FINISH
 *   ]
 *
 * ThrustConfig — configuration de propulsion.
 * Port of ThrustConfiguration (network fields) Java.
 *
 * Structure Tag :
 *   STRUCT [
 *     [0] BYTE    version
 *     [1] BYTE    automaticDampeners
 *     [2] BYTE    automaticReactivateDampeners
 *     [3] VECTOR3f thrustBalanceAxis  (version ≤ 1 : VECTOR4f with rotationBalance in w)
 *     [4] FLOAT   rotationBalance
 *     [5] BYTE    automaticDampenersOnExit
 *     [6] BYTE    thrustSharing
 *     [7] FLOAT   repulsorBalance (optionnel)
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';

// ── PowerState ────────────────────────────────────────────────────────────────

/**
 * Represents the PowerState model used by high-level entity component modelling.
 */
export class PowerState {
  /**
   * Creates a PowerState instance.
   *
   * @param initialPower - Input value for the constructor operation.
   * @param initialBatteryPower - Input value for the constructor operation.
   */
  constructor(
    /** Initial reactor power (double) */
    readonly initialPower: number,
    /** Initial battery power (double) */
    readonly initialBatteryPower: number,
  ) {}

  static EMPTY = new PowerState(0, 0);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): PowerState {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const power   = s[0]?.type === TagType.DOUBLE ? s[0].getDouble() : 0;
    const battery = s[1]?.type === TagType.DOUBLE ? s[1].getDouble() : 0;
    return new PowerState(power, battery);
  }

  /** Backward compatibility — legacy format (DOUBLE direct) */
  static fromTagOld(tag: Tag): PowerState {
    if (tag.type === TagType.DOUBLE) return new PowerState(tag.getDouble(), 0);
    return PowerState.fromTag(tag);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.double(null, this.initialPower),
      Tags.double(null, this.initialBatteryPower),
    ]);
  }

  /**
   * Returns a copy updated with Power.
   *
   * @param power - Input value for the withPower operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPower(power: number): PowerState {
    return new PowerState(power, this.initialBatteryPower);
  }

  /**
   * Returns a copy updated with Battery.
   *
   * @param battery - Input value for the withBattery operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBattery(battery: number): PowerState {
    return new PowerState(this.initialPower, battery);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `PowerState(power=${this.initialPower.toFixed(0)}, battery=${this.initialBatteryPower.toFixed(0)})`;
  }
}

// ── ThrustConfig ──────────────────────────────────────────────────────────────

/**
 * Represents the ThrustConfig model used by high-level entity component modelling.
 */
export class ThrustConfig {
  /**
   * Creates a ThrustConfig instance.
   *
   * @param version - Input value for the constructor operation.
   * @param automaticDampeners - Input value for the constructor operation.
   * @param automaticReactivateDampeners - Input value for the constructor operation.
   * @param thrustBalanceX - Input value for the constructor operation.
   * @param thrustBalanceY - Input value for the constructor operation.
   * @param thrustBalanceZ - Input value for the constructor operation.
   * @param rotationBalance - Input value for the constructor operation.
   * @param automaticDampenersOnExit - Input value for the constructor operation.
   * @param thrustSharing - Input value for the constructor operation.
   * @param repulsorBalance - Input value for the constructor operation.
   */
  constructor(
    readonly version: number,
    /** Automatic dampeners while stopped */
    readonly automaticDampeners: boolean,
    /** Automatic dampener reactivation */
    readonly automaticReactivateDampeners: boolean,
    /** Thrust balance (x, y, z) */
    readonly thrustBalanceX: number,
    readonly thrustBalanceY: number,
    readonly thrustBalanceZ: number,
    /** Rotation balance (0 = pure thrust, 1 = pure rotation) */
    readonly rotationBalance: number,
    /** Dampeners after leaving the cockpit */
    readonly automaticDampenersOnExit: boolean,
    /** Thrust sharing between docked entities */
    readonly thrustSharing: boolean,
    /** Repulsor balance */
    readonly repulsorBalance: number,
  ) {}

  static DEFAULT = new ThrustConfig(0, true, false, 0, 0, 0, 0, true, false, 0);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): ThrustConfig {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    const autoDamp = s[1]?.type === TagType.BYTE ? s[1].getByte() !== 0 : true;
    const autoReact = s[2]?.type === TagType.BYTE ? s[2].getByte() !== 0 : false;

    let bx = 0, by = 0, bz = 0, rotBal = 0;
    if (version <= 1 && s[3]?.type === TagType.VECTOR4f) {
      // Version 0/1 : VECTOR4f (x,y,z,rotationBalance)
      const v4 = s[3].getVector4f();
      bx = v4.x; by = v4.y; bz = v4.z; rotBal = v4.w;
    } else if (s[3]?.type === TagType.VECTOR3f) {
      const v3 = s[3].getVector3f();
      bx = v3.x; by = v3.y; bz = v3.z;
      rotBal = s[4]?.type === TagType.FLOAT ? s[4].getFloat() : 0;
    }

    const autoDampExit = s[5]?.type === TagType.BYTE ? s[5].getByte() !== 0 : false;
    const thrustShare  = s[6]?.type === TagType.BYTE ? s[6].getByte() !== 0 : false;
    const repulsor     = s[7]?.type === TagType.FLOAT ? s[7].getFloat() : 0;

    return new ThrustConfig(version, autoDamp, autoReact, bx, by, bz, rotBal,
      autoDampExit, thrustShare, repulsor);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.byte(null, this.version),
      Tags.byte(null, this.automaticDampeners ? 1 : 0),
      Tags.byte(null, this.automaticReactivateDampeners ? 1 : 0),
      Tags.vector3f(null, this.thrustBalanceX, this.thrustBalanceY, this.thrustBalanceZ),
      Tags.float(null, this.rotationBalance),
      Tags.byte(null, this.automaticDampenersOnExit ? 1 : 0),
      Tags.byte(null, this.thrustSharing ? 1 : 0),
      Tags.float(null, this.repulsorBalance),
    ]);
  }

  /**
   * Returns a copy updated with Dampeners.
   *
   * @param enabled - Input value for the withDampeners operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDampeners(enabled: boolean): ThrustConfig {
    return new ThrustConfig(this.version, enabled, this.automaticReactivateDampeners,
      this.thrustBalanceX, this.thrustBalanceY, this.thrustBalanceZ, this.rotationBalance,
      this.automaticDampenersOnExit, this.thrustSharing, this.repulsorBalance);
  }

  /**
   * Returns a copy updated with ThrustSharing.
   *
   * @param enabled - Input value for the withThrustSharing operation.
   * @returns The computed StarMade-Decoder value.
   */
  withThrustSharing(enabled: boolean): ThrustConfig {
    return new ThrustConfig(this.version, this.automaticDampeners, this.automaticReactivateDampeners,
      this.thrustBalanceX, this.thrustBalanceY, this.thrustBalanceZ, this.rotationBalance,
      this.automaticDampenersOnExit, enabled, this.repulsorBalance);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `ThrustConfig(dampeners=${this.automaticDampeners}, sharing=${this.thrustSharing}, rotBal=${this.rotationBalance.toFixed(2)})`;
  }
}
