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
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SMToolConfig } from './SMToolConfig.js';

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

const BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
});

// ── Behavior entry value ──────────────────────────────────────

export type BehaviorValue = string | number | boolean;

// ── BlockBehaviorConfig ───────────────────────────────────────────────────────

export class BlockBehaviorConfig {
  private readonly _values: Map<string, BehaviorValue>;
  private readonly _rawXml: any; // raw XML tree for round-tripping

  private constructor(values: Map<string, BehaviorValue>, raw: any) {
    this._values = values;
    this._rawXml = raw;
  }

  // ── Loading ────────────────────────────────────────────────────────────

  static load(config: SMToolConfig): BlockBehaviorConfig {
    const vanillaPath = path.join(config.paths.dataConfig, 'blockBehaviorConfig.xml');
    if (!fs.existsSync(vanillaPath)) {
      throw new Error(`blockBehaviorConfig.xml not found: ${vanillaPath}`);
    }

    const xml = fs.readFileSync(vanillaPath, 'utf8');
    const raw = PARSER.parse(xml);
    const values = BlockBehaviorConfig._flatten(raw);

    // Merge custom files (*.xml in customBlockBehaviorConfig/)
    const customDir = config.paths.custom.blockBehaviorConfig;
    if (fs.existsSync(customDir)) {
      for (const f of fs.readdirSync(customDir).filter(n => n.endsWith('.xml'))) {
        const customXml  = fs.readFileSync(path.join(customDir, f), 'utf8');
        const customRaw  = PARSER.parse(customXml);
        const customVals = BlockBehaviorConfig._flatten(customRaw);
        for (const [k, v] of customVals) values.set(k, v);
      }
    }

    return new BlockBehaviorConfig(values, raw);
  }

  static fromXml(xml: string): BlockBehaviorConfig {
    const raw = PARSER.parse(xml);
    return new BlockBehaviorConfig(BlockBehaviorConfig._flatten(raw), raw);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  get(key: string): BehaviorValue | undefined { return this._values.get(key); }
  getNumber(key: string, def = 0): number     { return Number(this._values.get(key) ?? def); }
  getBoolean(key: string, def = false): boolean {
    const v = this._values.get(key);
    return v === undefined ? def : (v === true || String(v).toLowerCase() === 'true');
  }
  getString(key: string, def = ''): string    { return String(this._values.get(key) ?? def); }

  /** All flattened entries (key = XML path using '.') */
  entries(): ReadonlyMap<string, BehaviorValue> { return this._values; }

  // ── Immutable updates ──────────────────────────────────────────────

  set(key: string, value: BehaviorValue): BlockBehaviorConfig {
    const newValues = new Map(this._values);
    newValues.set(key, value);
    return new BlockBehaviorConfig(newValues, this._rawXml);
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Writes modified values to customBlockBehaviorConfig/customBlockBehaviorConfig.xml
   */
  saveCustom(config: SMToolConfig, vanilla: BlockBehaviorConfig): void {
    const customDir = config.paths.custom.blockBehaviorConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });

    // Write only values that differ from vanilla
    const diff: Record<string, BehaviorValue> = {};
    for (const [k, v] of this._values) {
      if (vanilla.get(k) !== v) diff[k] = v;
    }

    if (Object.keys(diff).length === 0) return;

    // Build minimal XML with the modified values
    const xmlObj = BlockBehaviorConfig._buildXmlFromFlat(diff);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + BUILDER.build(xmlObj);
    const outPath = path.join(customDir, 'customBlockBehaviorConfig.xml');
    fs.writeFileSync(outPath, xml, 'utf8');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Aplatit l'arbre XML en Map<"key.subkey", value> */
  private static _flatten(obj: any, prefix = ''): Map<string, BehaviorValue> {
    const result = new Map<string, BehaviorValue>();
    if (!obj || typeof obj !== 'object') return result;
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@_')) continue;
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of BlockBehaviorConfig._flatten(v, fullKey)) {
          result.set(sk, sv);
        }
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        result.set(fullKey, v);
      }
    }
    return result;
  }

  /** Rebuilds an XML object from flattened keys */
  private static _buildXmlFromFlat(flat: Record<string, BehaviorValue>): any {
    const result: any = {};
    for (const [key, value] of Object.entries(flat)) {
      const parts = key.split('.');
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    }
    return result;
  }

  toString(): string { return `BlockBehaviorConfig(${this._values.size} values)`; }
}
