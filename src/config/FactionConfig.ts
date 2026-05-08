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

const PARSER = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true, trimValues: true });
const BUILDER = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, indentBy: '  ' });

export type FactionConfigValue = string | number | boolean;

export class FactionConfig {
  private readonly _values: Map<string, FactionConfigValue>;
  private readonly _rawXml: any;

  private constructor(values: Map<string, FactionConfigValue>, raw: any) {
    this._values = values;
    this._rawXml = raw;
  }

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

  static fromXml(xml: string): FactionConfig {
    const raw = PARSER.parse(xml);
    return new FactionConfig(FactionConfig._flatten(raw), raw);
  }

  get(key: string): FactionConfigValue | undefined { return this._values.get(key); }
  getNumber(key: string, def = 0): number  { return Number(this._values.get(key) ?? def); }
  getBoolean(key: string, def = false): boolean {
    const v = this._values.get(key);
    return v === undefined ? def : (v === true || String(v).toLowerCase() === 'true');
  }
  getString(key: string, def = ''): string { return String(this._values.get(key) ?? def); }
  entries(): ReadonlyMap<string, FactionConfigValue> { return this._values; }

  set(key: string, value: FactionConfigValue): FactionConfig {
    const m = new Map(this._values);
    m.set(key, value);
    return new FactionConfig(m, this._rawXml);
  }

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

  toString(): string { return `FactionConfig(${this._values.size} values)`; }
}
