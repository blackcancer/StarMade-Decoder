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
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SMToolConfig } from './SMToolConfig.js';

/**
 * Defines PARSER for StarMade configuration loading, editing, and metadata enrichment.
 */
const PARSER = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true, trimValues: true });
/**
 * Defines BUILDER for StarMade configuration loading, editing, and metadata enrichment.
 */
const BUILDER = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, indentBy: '  ' });

/**
 * Defines the FactionConfigValue type used by StarMade configuration loading, editing, and metadata enrichment.
 */
export type FactionConfigValue = string | number | boolean;

/**
 * Represents the FactionConfig model used by StarMade configuration loading, editing, and metadata enrichment.
 */
export class FactionConfig {
  private readonly _values: Map<string, FactionConfigValue>;
  private readonly _rawXml: any;

  /**
   * Creates a FactionConfig instance.
   *
   * @param values - Input value for the constructor operation.
   * @param raw - Input value for the constructor operation.
   */
  private constructor(values: Map<string, FactionConfigValue>, raw: any) {
    this._values = values;
    this._rawXml = raw;
  }

  /**
   * Loads data from StarMade project files.
   *
   * @param config - Input value for the load operation.
   * @returns The computed StarMade-Decoder value.
   */
  static load(config: SMToolConfig): FactionConfig {
    // Vanilla (read-only)
    const vanillaPath = path.join(config.paths.dataConfig, 'FactionConfig.xml');
    let raw: any = {};
    if (fs.existsSync(vanillaPath)) {
      raw = PARSER.parse(fs.readFileSync(vanillaPath, 'utf8'));
    }
    const values = FactionConfig._flatten(raw);

    // Custom (surcharge)
    const customPath = path.join(config.paths.custom.factionConfig, 'FactionConfig.xml');
    if (fs.existsSync(customPath)) {
      const customRaw = PARSER.parse(fs.readFileSync(customPath, 'utf8'));
      for (const [k, v] of FactionConfig._flatten(customRaw)) values.set(k, v);
    }

    return new FactionConfig(values, raw);
  }

  /**
   * Creates a value from Xml.
   *
   * @param xml - Input value for the fromXml operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromXml(xml: string): FactionConfig {
    const raw = PARSER.parse(xml);
    return new FactionConfig(FactionConfig._flatten(raw), raw);
  }

  /**
   * Returns the requested value.
   *
   * @param key - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(key: string): FactionConfigValue | undefined { return this._values.get(key); }
  /**
   * Returns Number.
   *
   * @param key - Input value for the getNumber operation.
   * @param def - Input value for the getNumber operation.
   * @returns The computed StarMade-Decoder value.
   */
  getNumber(key: string, def = 0): number  { return Number(this._values.get(key) ?? def); }
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
  getString(key: string, def = ''): string { return String(this._values.get(key) ?? def); }
  /**
   * Returns iterable key/value entries for this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  entries(): ReadonlyMap<string, FactionConfigValue> { return this._values; }

  /**
   * Stores the requested value.
   *
   * @param key - Input value for the set operation.
   * @param value - Input value for the set operation.
   * @returns The computed StarMade-Decoder value.
   */
  set(key: string, value: FactionConfigValue): FactionConfig {
    const m = new Map(this._values);
    m.set(key, value);
    return new FactionConfig(m, this._rawXml);
  }

  /**
   * Saves Custom back to StarMade project files.
   *
   * @param config - Input value for the saveCustom operation.
   * @param vanilla - Input value for the saveCustom operation.
   */
  saveCustom(config: SMToolConfig, vanilla: FactionConfig): void {
    const customDir = config.paths.custom.factionConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    const diff: Record<string, FactionConfigValue> = {};
    for (const [k, v] of this._values) {
      if (vanilla.get(k) !== v) diff[k] = v;
    }
    if (Object.keys(diff).length === 0) return;
    const xmlObj = FactionConfig._buildXmlFromFlat(diff);
    const outPath = path.join(customDir, 'FactionConfig.xml');
    fs.writeFileSync(outPath, '<?xml version="1.0" encoding="UTF-8"?>\n' + BUILDER.build(xmlObj), 'utf8');
  }

  /**
   * Handles the flatten operation used by StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param obj - Input value for the _flatten operation.
   * @param prefix - Input value for the _flatten operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _flatten(obj: any, prefix = ''): Map<string, FactionConfigValue> {
    const result = new Map<string, FactionConfigValue>();
    if (!obj || typeof obj !== 'object') return result;
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@_')) continue;
      const fk = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of FactionConfig._flatten(v, fk)) result.set(sk, sv);
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        result.set(fk, v);
      }
    }
    return result;
  }

  /**
   * Builds XmlFromFlat for StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param flat - Input value for the _buildXmlFromFlat operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _buildXmlFromFlat(flat: Record<string, FactionConfigValue>): any {
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
  toString(): string { return `FactionConfig(${this._values.size} values)`; }
}
