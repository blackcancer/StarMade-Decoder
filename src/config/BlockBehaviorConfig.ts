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

/**
 * Defines PARSER for StarMade configuration loading, editing, and metadata enrichment.
 */
const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

/**
 * Defines BUILDER for StarMade configuration loading, editing, and metadata enrichment.
 */
const BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
});

// ── Behavior entry value ──────────────────────────────────────

/**
 * Defines the BehaviorValue type used by StarMade configuration loading, editing, and metadata enrichment.
 */
export type BehaviorValue = string | number | boolean;

// ── BlockBehaviorConfig ───────────────────────────────────────────────────────

/**
 * Represents the BlockBehaviorConfig model used by StarMade configuration loading, editing, and metadata enrichment.
 */
export class BlockBehaviorConfig {
  private readonly _values: Map<string, BehaviorValue>;
  private readonly _rawXml: any; // raw XML tree for round-tripping

  /**
   * Creates a BlockBehaviorConfig instance.
   *
   * @param values - Input value for the constructor operation.
   * @param raw - Input value for the constructor operation.
   */
  private constructor(values: Map<string, BehaviorValue>, raw: any) {
    this._values = values;
    this._rawXml = raw;
  }

  // ── Loading ────────────────────────────────────────────────────────────

  /**
   * Loads data from StarMade project files.
   *
   * @param config - Input value for the load operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Creates a value from Xml.
   *
   * @param xml - Input value for the fromXml operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromXml(xml: string): BlockBehaviorConfig {
    const raw = PARSER.parse(xml);
    return new BlockBehaviorConfig(BlockBehaviorConfig._flatten(raw), raw);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Returns the requested value.
   *
   * @param key - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(key: string): BehaviorValue | undefined { return this._values.get(key); }
  /**
   * Returns Number.
   *
   * @param key - Input value for the getNumber operation.
   * @param def - Input value for the getNumber operation.
   * @returns The computed StarMade-Decoder value.
   */
  getNumber(key: string, def = 0): number     { return Number(this._values.get(key) ?? def); }
  /**
   * Returns Boolean.
   *
   * @param key - Input value for the getBoolean operation.
   * @param def - Input value for the getBoolean operation.
   * @returns The computed StarMade-Decoder value.
   */
  getBoolean(key: string, def = false): boolean {
    const v = this._values.get(key);
    return v === undefined ? def : (v === true || String(v).toLowerCase() === 'true');
  }
  /**
   * Returns String.
   *
   * @param key - Input value for the getString operation.
   * @param def - Input value for the getString operation.
   * @returns The computed StarMade-Decoder value.
   */
  getString(key: string, def = ''): string    { return String(this._values.get(key) ?? def); }

  /** All flattened entries (key = XML path using '.') */
  entries(): ReadonlyMap<string, BehaviorValue> { return this._values; }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Stores the requested value.
   *
   * @param key - Input value for the set operation.
   * @param value - Input value for the set operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `BlockBehaviorConfig(${this._values.size} values)`; }
}
