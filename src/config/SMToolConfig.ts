/**
 * @fileoverview SMtool Config
 *
 * Handles StarMade configuration data with typed accessors, immutable updates, and serialization helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SMToolConfig — root configuration for the StarMade-Decoder SDK.
 *
 * File: SMToolConfig.json (at the project root)
 *
 * {
 *   "starmadeDir": "D:/Jeux/Steam/steamapps/common/StarMade/StarMade",
 *   "worldDir": "world0"
 * }
 *
 * starmadeDir is the StarMade installation directory.
 * worldDir is the world name under server-database/ (default: world0).
 */

import fs from 'fs';
import path from 'path';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface SMToolConfigData {
  /** Absolute StarMade installation directory. Example: D:/Jeux/.../StarMade */
  starmadeDir: string;
  /** World name under server-database/. Default: world0 */
  worldDir?: string;
}

// ── Derived paths (port of GameResourceLoader.java) ────────────────────────

/** Standard paths in a StarMade installation. */
export interface StarMadePaths {
  /** StarMade root */
  root: string;
  /** data/config/ — read-only */
  dataConfig: string;
  /** data/config/defaultSettings/ — read-only (templates) */
  defaultSettings: string;
  /** server.cfg — read + write */
  serverCfg: string;
  /** server-database/{worldDir}/ */
  worldDatabase: string;
  /** Custom folders — SDK writes */
  custom: {
    blockConfig:         string; // ./customBlockConfig/
    blockBehaviorConfig: string; // ./customBlockBehaviorConfig/
    factionConfig:       string; // ./customFactionConfig/
    effectConfig:        string; // ./customEffectConfig/
  };
}

// ── Main class ─────────────────────────────────────────────────────────

export class SMToolConfig {
  static readonly FILE_NAME = 'SMToolConfig.json';
  static readonly DEFAULT_WORLD = 'world0';

  readonly starmadeDir: string;
  readonly worldDir: string;
  readonly paths: StarMadePaths;

  private constructor(data: Required<SMToolConfigData>) {
    this.starmadeDir = path.resolve(data.starmadeDir.replace(/\\/g, '/'));
    this.worldDir    = data.worldDir;
    this.paths       = this._buildPaths();
  }

  // ── Loading ────────────────────────────────────────────────────────────

  /**
   * Loads SMToolConfig.json from the project directory or a custom path.
   * Creates the file with empty values when it is missing.
   */
  static load(projectRoot?: string): SMToolConfig {
    const dir      = projectRoot ? path.resolve(projectRoot) : process.cwd();
    const filePath = path.join(dir, SMToolConfig.FILE_NAME);

    if (!fs.existsSync(filePath)) {
      const defaults: SMToolConfigData = {
        starmadeDir: '',
        worldDir:    SMToolConfig.DEFAULT_WORLD,
      };
      fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
      throw new Error(
        `SMToolConfig.json created at ${filePath}. ` +
        `Set "starmadeDir" to the path of your StarMade installation.`
      );
    }

    const raw  = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as SMToolConfigData;

    if (!data.starmadeDir || data.starmadeDir.trim() === '') {
      throw new Error(
        `"starmadeDir" is empty in ${filePath}. ` +
        `Set it to the path of your StarMade installation.`
      );
    }

    return new SMToolConfig({
      starmadeDir: data.starmadeDir,
      worldDir:    data.worldDir ?? SMToolConfig.DEFAULT_WORLD,
    });
  }

  /** Creates an instance directly without a file. */
  static fromData(data: SMToolConfigData): SMToolConfig {
    if (!data.starmadeDir) throw new Error('starmadeDir is required');
    return new SMToolConfig({
      starmadeDir: data.starmadeDir,
      worldDir:    data.worldDir ?? SMToolConfig.DEFAULT_WORLD,
    });
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /** Saves to SMToolConfig.json. */
  save(projectRoot?: string): void {
    const dir      = projectRoot ? path.resolve(projectRoot) : process.cwd();
    const filePath = path.join(dir, SMToolConfig.FILE_NAME);
    const data: SMToolConfigData = {
      starmadeDir: this.starmadeDir,
      worldDir:    this.worldDir,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  // ── Immutable updates ──────────────────────────────────────────────

  withStarmadeDir(dir: string): SMToolConfig {
    return new SMToolConfig({ starmadeDir: dir, worldDir: this.worldDir });
  }

  withWorldDir(world: string): SMToolConfig {
    return new SMToolConfig({ starmadeDir: this.starmadeDir, worldDir: world });
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /** Checks that starmadeDir exists and contains a valid StarMade installation. */
  validate(): void {
    if (!fs.existsSync(this.starmadeDir)) {
      throw new Error(`starmadeDir not found: ${this.starmadeDir}`);
    }
    if (!fs.existsSync(this.paths.dataConfig)) {
      throw new Error(
        `data/config/ not found in ${this.starmadeDir}. ` +
        `Check that starmadeDir points to a valid StarMade installation.`
      );
    }
    if (!fs.existsSync(this.paths.worldDatabase)) {
      throw new Error(
        `World "${this.worldDir}" not found in server-database/. ` +
        `Check worldDir in SMToolConfig.json.`
      );
    }
  }

  /** Returns true when the config is valid without throwing. */
  isValid(): boolean {
    try { this.validate(); return true; }
    catch { return false; }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _buildPaths(): StarMadePaths {
    const r = this.starmadeDir;
    return {
      root:           r,
      dataConfig:     path.join(r, 'data', 'config'),
      defaultSettings: path.join(r, 'data', 'config', 'defaultSettings'),
      serverCfg:      path.join(r, 'server.cfg'),
      worldDatabase:  path.join(r, 'server-database', this.worldDir),
      custom: {
        blockConfig:         path.join(r, 'customBlockConfig'),
        blockBehaviorConfig: path.join(r, 'customBlockBehaviorConfig'),
        factionConfig:       path.join(r, 'customFactionConfig'),
        effectConfig:        path.join(r, 'customEffectConfig'),
      },
    };
  }

  toString(): string {
    return `SMToolConfig(starmadeDir="${this.starmadeDir}", worldDir="${this.worldDir}")`;
  }
}
