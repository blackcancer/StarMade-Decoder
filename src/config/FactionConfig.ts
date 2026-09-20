/**
 * @fileoverview Faction Config
 *
 * Handles StarMade configuration data with typed accessors, immutable updates, and serialization helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * FactionConfig — reading de data/config/FactionConfig.xml + customFactionConfig/FactionConfig.xml
 *
 * Port of FactionConfig.java
 * Chemins Java :
 *   factionModConfigPath = "./customFactionConfig/FactionConfig.xml"     (live)
 *   factionConfigDefault = "./customFactionConfig/FactionConfigTemplate.xml"
 *
 * Writes only to customFactionConfig/FactionConfig.xml.
 */

import fs from 'fs';
import path from 'path';
import type { SMToolConfig } from './SMToolConfig.js';
import { XmlConfigDocument } from './XmlConfigDocument.js';
import { formatLimits, formatText, type FormatLimits } from '../core/FormatLimits.js';
import { DecodeError } from '../core/DecodeError.js';

/** Scalar configuration values. Unknown XML extensions remain part of the document. */
export type FactionConfigValue = string | number | boolean;

/** Immutable XML configuration with memory exports and explicit custom-file writes. */
export class FactionConfig {
  readonly #document: XmlConfigDocument;

  /** Retains an immutable private XML document. */
  private constructor(document: XmlConfigDocument) { this.#document = document; Object.freeze(this); }

  /** Reads vanilla and custom XML without changing any source file. Options bound bytes and XML nodes. */
  static load(config: SMToolConfig, options: FormatLimits = {}): FactionConfig {
    const vanillaPath = path.join(config.paths.dataConfig, 'FactionConfig.xml');
    let document = fs.existsSync(vanillaPath) ? readConfig(vanillaPath, options) : XmlConfigDocument.fromXml('', options);
    const customPath = path.join(config.paths.custom.factionConfig, 'FactionConfig.xml');
    if (fs.existsSync(customPath)) document = document.merge(readConfig(customPath, options));
    return new FactionConfig(document);
  }

  /** Parses XML in memory, preserving its root name, attributes, comments and unknown nodes. */
  static fromXml(xml: string, options: FormatLimits = {}): FactionConfig {
    return new FactionConfig(XmlConfigDocument.fromXml(xml, options));
  }

  /** Reads a scalar at an unambiguous dotted XML path; literal dots are escaped as backslash-dot. */
  get(key: string): FactionConfigValue | undefined { return this.#document.get(key); }
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
  entries(): ReadonlyMap<string, FactionConfigValue> { return this.#document.entries(); }
  /** Returns an independently edited document; invalid values and ambiguous paths throw. */
  set(key: string, value: FactionConfigValue): FactionConfig {
    return new FactionConfig(this.#document.set(key, value));
  }
  /** Exports the complete XML in memory, preserving unchanged source bytes. */
  toXml(): string { return this.#document.toXml(); }

  /** Writes only changed XML subtrees to the explicit custom path, preserving extension metadata. */
  saveCustom(config: SMToolConfig, vanilla: FactionConfig): void {
    const xml = this.#document.difference(vanilla.#document);
    if (!xml) return;
    const customDir = config.paths.custom.factionConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'FactionConfig.xml'), xml, 'utf8');
  }

  /** Builds the diagnostic summary; use toXml for a complete export. */
  toString(): string { return `FactionConfig(${this.entries().size} values)`; }
}

/** Checks the selected file's byte budget before reading; decoding rejects invalid UTF-8. */
function readConfig(file: string, options: FormatLimits): XmlConfigDocument {
  const limits = formatLimits(options);
  if (fs.statSync(file).size > limits.maxBytes) throw new DecodeError('E_LIMIT', 'Configuration byte budget exceeded');
  return XmlConfigDocument.fromXml(formatText(fs.readFileSync(file)), limits);
}
