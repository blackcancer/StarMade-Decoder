/**
 * @fileoverview Block Behavior Config
 *
 * Handles StarMade configuration data with typed accessors, immutable updates, and serialization helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * BlockBehaviorConfig — reading de blockBehaviorConfig.xml + customBlockBehaviorConfig/*.xml
 *
 * Port of VoidElementManager.java
 * Reads from data/config/ and writes to customBlockBehaviorConfig/.
 *
 * The file contains global numeric behavior values
 * (shields, power, thrust, missiles, etc.) as named XML tags.
 */

import fs from 'fs';
import path from 'path';
import type { SMToolConfig } from './SMToolConfig.js';
import { XmlConfigDocument } from './XmlConfigDocument.js';
import { formatLimits, formatText, type FormatLimits } from '../core/FormatLimits.js';
import { DecodeError } from '../core/DecodeError.js';

/** Scalar configuration values. Unknown XML extensions remain part of the document. */
export type BehaviorValue = string | number | boolean;

/** Immutable XML configuration with memory exports and explicit custom-file writes. */
export class BlockBehaviorConfig {
  readonly #document: XmlConfigDocument;

  /** Retains an immutable private XML document. */
  private constructor(document: XmlConfigDocument) { this.#document = document; Object.freeze(this); }

  /** Reads vanilla and custom XML without changing any source file. Options bound bytes and XML nodes. */
  static load(config: SMToolConfig, options: FormatLimits = {}): BlockBehaviorConfig {
    const vanillaPath = path.join(config.paths.dataConfig, 'blockBehaviorConfig.xml');
    if (!fs.existsSync(vanillaPath)) throw new Error(`blockBehaviorConfig.xml not found: ${vanillaPath}`);
    let document = readConfig(vanillaPath, options);
    const customDir = config.paths.custom.blockBehaviorConfig;
    if (fs.existsSync(customDir)) {
      for (const file of fs.readdirSync(customDir).filter(name => name.endsWith('.xml')).sort()) {
        document = document.merge(readConfig(path.join(customDir, file), options));
      }
    }
    return new BlockBehaviorConfig(document);
  }

  /** Parses XML in memory, preserving its root name, attributes, comments and unknown nodes. */
  static fromXml(xml: string, options: FormatLimits = {}): BlockBehaviorConfig {
    return new BlockBehaviorConfig(XmlConfigDocument.fromXml(xml, options));
  }

  /** Reads a scalar at an unambiguous dotted XML path; literal dots are escaped as backslash-dot. */
  get(key: string): BehaviorValue | undefined { return this.#document.get(key); }
  /** Reads a number, returning the explicit fallback only when the path is absent. */
  getNumber(key: string, def = 0): number { return Number(this.get(key) ?? def); }
  /** Reads a boolean, returning the explicit fallback only when the path is absent. */
  getBoolean(key: string, def = false): boolean {
    const value = this.get(key);
    return value === undefined ? def : value === true || String(value).toLowerCase() === 'true';
  }
  /** Reads text, returning the explicit fallback only when the path is absent. */
  getString(key: string, def = ''): string { return String(this.get(key) ?? def); }
  /** Detached scalar entries; repeated siblings use explicit zero-based indices such as Item[0]. */
  entries(): ReadonlyMap<string, BehaviorValue> { return this.#document.entries(); }
  /** Returns an independently edited document; invalid values and ambiguous paths throw. */
  set(key: string, value: BehaviorValue): BlockBehaviorConfig {
    return new BlockBehaviorConfig(this.#document.set(key, value));
  }
  /** Exports the complete XML in memory, preserving unchanged source bytes. */
  toXml(): string { return this.#document.toXml(); }

  /** Writes only changed XML subtrees to the explicit custom path, preserving extension metadata. */
  saveCustom(config: SMToolConfig, vanilla: BlockBehaviorConfig): void {
    const xml = this.#document.difference(vanilla.#document);
    if (!xml) return;
    const customDir = config.paths.custom.blockBehaviorConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'customBlockBehaviorConfig.xml'), xml, 'utf8');
  }

  /** Builds the diagnostic summary; use toXml for a complete export. */
  toString(): string { return `BlockBehaviorConfig(${this.entries().size} values)`; }
}

/** Checks the selected file's byte budget before reading; decoding rejects invalid UTF-8. */
function readConfig(file: string, options: FormatLimits): XmlConfigDocument {
  const limits = formatLimits(options);
  if (fs.statSync(file).size > limits.maxBytes) throw new DecodeError('E_LIMIT', 'Configuration byte budget exceeded');
  return XmlConfigDocument.fromXml(formatText(fs.readFileSync(file)), limits);
}
