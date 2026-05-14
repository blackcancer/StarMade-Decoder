/**
 * @fileoverview StarMade Block Configuration Parser
 *
 * Parses and writes BlockConfig XML files, preserving immutable block definitions and custom block overrides.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Reads and writes StarMade BlockConfig.xml data.
 *
 * Merged load order:
 *   1. data/config/BlockConfig.xml             — vanilla block definitions (read-only)
 *   2. customBlockConfig/BlockConfigImport.xml — custom overrides/additions, when present
 *
 * Writes are intentionally limited to customBlockConfig/BlockConfigImport.xml.
 *
 * Port of ElementInformation.java + ElementParser.java + ElementKeyMap.java.
 *
 * XML structure:
 * <Config>
 *   <Element>
 *     <General>
 *       <Category>
 *         <SubCategory>
 *           <Block icon="N" name="..." textureId="..." type="TYPE_NAME">
 *             <Hitpoints>N</Hitpoints>
 *             <Mass>N.N</Mass>
 *             <Volume>N.N</Volume>
 *             <Price>N</Price>
 *             <Description>...</Description>
 *             <ArmorValue>N.N</ArmorValue>
 *             <Placable>true</Placable>
 *             <InShop>true</InShop>
 *             <Orientation>true</Orientation>
 *             <CanActivate>false</CanActivate>
 *             <Deprecated>false</Deprecated>
 *             <BlockStyle>N</BlockStyle>
 *             <SlabIds>N, N, N</SlabIds>
 *             <StyleIds>N, N, N</StyleIds>
 *             <BlockComputerReference>N</BlockComputerReference>
 *             ...
 *           </Block>
 *         </SubCategory>
 *       </Category>
 *     </General>
 *   </Element>
 * </Config>
 *
 * The numeric type ID comes from the <Block> node's "type" attribute.
 */

import fs from 'fs';
import path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SMToolConfig } from './SMToolConfig.js';

// ── BlockDefinition — ElementInformation.java Port ───────────────────────────

export class BlockDefinition {
  constructor(
    /** Numeric block ID from the XML "type" attribute. */
    readonly id: number,
    /** Display name from the XML "name" attribute. */
    readonly name: string,
    /** Texture icon index from the XML "icon" attribute. */
    readonly icon: number,
    /** Block hit points. */
    readonly hp: number,
    /** Block mass in tonnes. */
    readonly mass: number,
    /** Block volume in cubic meters. */
    readonly volume: number,
    /** Block price in credits. */
    readonly price: number,
    /** User-facing description. */
    readonly description: string,
    /** Armor value (0.0 means no armor). */
    readonly armor: number,
    /** Whether the block can be placed by a player. */
    readonly isPlacable: boolean,
    /** Whether the block is available in shops. */
    readonly inShop: boolean,
    /** Whether the block supports orientation/rotation. */
    readonly hasOrientation: boolean,
    /** Whether the block can be toggled on/off. */
    readonly canActivate: boolean,
    /** Whether the block is deprecated and should not be used. */
    readonly isDeprecated: boolean,
    /** Block style (0=normal, 1=slab, etc.). */
    readonly blockStyle: number,
    /** IDs of slab variants. */
    readonly slabIds: readonly number[],
    /** IDs of style variants. */
    readonly styleIds: readonly number[],
    /** Reference computer block ID (0 means none). */
    readonly computerReference: number,
    /** XML category/type name (for example "Grey Basic Armor"). */
    readonly xmlTypeName: string,
    /** Texture IDs from the XML "textureId" attribute. */
    readonly textureId: readonly number[] = [],
    /** Slab thickness mode from BlockConfig.xml. */
    readonly slab: number = 0,
    /** Texture side grouping mode from BlockConfig.xml. */
    readonly individualSides: number = 1,
    /** Whether side textures rotate relative to orientation. */
    readonly sideTexturesPointToOrientation: boolean = false,
    /** Whether the block has active/inactive texture variants. */
    readonly hasActivationTexture: boolean = false,
    /** Whether the block has animated texture frames. */
    readonly animated: boolean = false,
    /** Whether the block should render with alpha. */
    readonly transparency: boolean = false,
    /** Whether the block is a light source. */
    readonly lightSource: boolean = false,
    /** RGBA light color/intensity from BlockConfig.xml. */
    readonly lightSourceColor: readonly number[] = [],
    /** Whether texture IDs address a 4x4 extended texture block. */
    readonly extendedTexture4x4: boolean = false,
  ) {}

  /** Returns an immutable variant with one or more modified properties. */
  with(overrides: Partial<{
    name: string; hp: number; mass: number; volume: number;
    price: number; description: string; armor: number;
    isPlacable: boolean; inShop: boolean; hasOrientation: boolean;
    canActivate: boolean; isDeprecated: boolean; blockStyle: number;
    textureId: readonly number[]; slab: number; individualSides: number;
    sideTexturesPointToOrientation: boolean; hasActivationTexture: boolean;
    animated: boolean; transparency: boolean; lightSource: boolean;
    lightSourceColor: readonly number[]; extendedTexture4x4: boolean;
  }>): BlockDefinition {
    return new BlockDefinition(
      this.id,
      overrides.name         ?? this.name,
      this.icon,
      overrides.hp           ?? this.hp,
      overrides.mass         ?? this.mass,
      overrides.volume       ?? this.volume,
      overrides.price        ?? this.price,
      overrides.description  ?? this.description,
      overrides.armor        ?? this.armor,
      overrides.isPlacable   ?? this.isPlacable,
      overrides.inShop       ?? this.inShop,
      overrides.hasOrientation ?? this.hasOrientation,
      overrides.canActivate  ?? this.canActivate,
      overrides.isDeprecated ?? this.isDeprecated,
      overrides.blockStyle   ?? this.blockStyle,
      this.slabIds,
      this.styleIds,
      this.computerReference,
      this.xmlTypeName,
      overrides.textureId ?? this.textureId,
      overrides.slab ?? this.slab,
      overrides.individualSides ?? this.individualSides,
      overrides.sideTexturesPointToOrientation ?? this.sideTexturesPointToOrientation,
      overrides.hasActivationTexture ?? this.hasActivationTexture,
      overrides.animated ?? this.animated,
      overrides.transparency ?? this.transparency,
      overrides.lightSource ?? this.lightSource,
      overrides.lightSourceColor ?? this.lightSourceColor,
      overrides.extendedTexture4x4 ?? this.extendedTexture4x4,
    );
  }

  toString(): string {
    return `BlockDefinition(id=${this.id}, name="${this.name}", hp=${this.hp}, mass=${this.mass})`;
  }
}

// ── XML Parser ───────────────────────────────────────────────────────────────

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => ['Block'].includes(name),
});

const XML_BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
});

// ── BlockConfig ────────────────────────────────────────────────────────────────

export class BlockConfig {
  /** Map from numeric ID to BlockDefinition. */
  private readonly _byId:   Map<number, BlockDefinition>;
  /** Map from lowercase name to BlockDefinition. */
  private readonly _byName: Map<string, BlockDefinition>;

  private constructor(blocks: BlockDefinition[]) {
    this._byId   = new Map(blocks.map(b => [b.id,   b]));
    this._byName = new Map(blocks.map(b => [b.name.toLowerCase(), b]));
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  static load(config: SMToolConfig): BlockConfig {
    const vanillaPath    = path.join(config.paths.dataConfig, 'BlockConfig.xml');
    const blockTypesPath = path.join(config.paths.dataConfig, 'BlockTypes.properties');
    if (!fs.existsSync(vanillaPath)) {
      throw new Error(`BlockConfig.xml not found: ${vanillaPath}`);
    }
    const typeIds = BlockConfig._loadBlockTypes(blockTypesPath);
    const blocks  = BlockConfig._parseFile(vanillaPath, typeIds);
    const customPath = path.join(config.paths.custom.blockConfig, 'BlockConfigImport.xml');
    if (fs.existsSync(customPath)) {
      for (const cb of BlockConfig._parseFile(customPath, typeIds).values()) blocks.set(cb.id, cb);
    }
    return new BlockConfig([...blocks.values()]);
  }

  static fromXml(xml: string, blockTypes = new Map<string, number>()): BlockConfig {
    return new BlockConfig([...BlockConfig._parseXml(xml, blockTypes).values()]);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  getById(id: number): BlockDefinition | undefined    { return this._byId.get(id); }
  getByName(name: string): BlockDefinition | undefined { return this._byName.get(name.toLowerCase()); }
  get all(): BlockDefinition[] { return [...this._byId.values()]; }
  get size(): number { return this._byId.size; }
  [Symbol.iterator](): IterableIterator<BlockDefinition> { return this._byId.values(); }

  // ── Immutable Updates ────────────────────────────────────────────────────

  set(block: BlockDefinition): BlockConfig {
    const all = [...this._byId.values()];
    const idx = all.findIndex(b => b.id === block.id);
    if (idx >= 0) all[idx] = block; else all.push(block);
    return new BlockConfig(all);
  }

  delete(id: number): BlockConfig {
    return new BlockConfig([...this._byId.values()].filter(b => b.id !== id));
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  saveCustom(config: SMToolConfig, vanilla: BlockConfig): void {
    const customDir = config.paths.custom.blockConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    const customBlocks = [...this._byId.values()].filter(b => {
      const orig = vanilla.getById(b.id);
      if (!orig) return true;
      return JSON.stringify(b) !== JSON.stringify(orig);
    });
    const xml = BlockConfig._toXml(customBlocks);
    fs.writeFileSync(path.join(customDir, 'BlockConfigImport.xml'), xml, 'utf8');
  }

  saveAll(config: SMToolConfig): void {
    const customDir = config.paths.custom.blockConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, 'BlockConfigImport.xml'),
      BlockConfig._toXml([...this._byId.values()]),
      'utf8'
    );
  }

  // ── Internal Parsing ─────────────────────────────────────────────────────

  /** Loads BlockTypes.properties into Map<typeName, numericId>. */
  private static _loadBlockTypes(filePath: string): Map<string, number> {
    if (!fs.existsSync(filePath)) return new Map();
    return BlockConfig._parseBlockTypes(fs.readFileSync(filePath, 'utf8'));
  }

  static _parseBlockTypes(content: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const line of content.split('\n')) {
      const t  = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const name = t.slice(0, eq).trim();
      const id   = parseInt(t.slice(eq + 1).trim(), 10);
      if (name && !isNaN(id)) map.set(name, id);
    }
    return map;
  }

  private static _parseFile(filePath: string, typeIds: Map<string, number>): Map<number, BlockDefinition> {
    return BlockConfig._parseXml(fs.readFileSync(filePath, 'utf8'), typeIds);
  }

  private static _parseXml(xml: string, typeIds: Map<string, number>): Map<number, BlockDefinition> {
    const result = XML_PARSER.parse(xml);
    const blocks = new Map<number, BlockDefinition>();
    BlockConfig._walkNode(result, typeIds, blocks);
    return blocks;
  }

  /**
   * Recursively walks the parsed XML tree.
   * A Block node has @_type = TypeName (for example "GREY_HULL") and @_name = display name.
   * The numeric ID is resolved through BlockTypes.properties (typeIds).
   * In BlockConfigImport.xml, @_type may also be a direct integer ID.
   */
  private static _walkNode(node: any, typeIds: Map<string, number>, blocks: Map<number, BlockDefinition>): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) BlockConfig._walkNode(item, typeIds, blocks);
      return;
    }

    const rawType = node['@_type'];
    const rawName = node['@_name'];

    if (rawType !== undefined && rawName !== undefined) {
      let id: number;
      const parsed = parseInt(String(rawType), 10);
      if (!isNaN(parsed) && parsed > 0) {
        id = parsed; // custom import using a direct numeric ID
      } else {
        id = typeIds.get(String(rawType)) ?? 0;
      }

      if (id > 0) {
        const block = BlockConfig._nodeToBlock(id, String(rawType), node);
        if (block) blocks.set(id, block);
      }
    }

    for (const key of Object.keys(node)) {
      if (!key.startsWith('@_')) BlockConfig._walkNode(node[key], typeIds, blocks);
    }
  }

  private static _nodeToBlock(id: number, typeName: string, node: any): BlockDefinition | null {
    const g   = (key: string, def: any = '') => node[key] ?? def;
    const gb  = (key: string, def = false): boolean => {
      const v = node[key];
      if (v === undefined) return def;
      return v === true || String(v).toLowerCase() === 'true';
    };
    const gn  = (key: string, def = 0): number => {
      const v = node[key];
      if (v === undefined) return def;
      return typeof v === 'number' ? v : parseFloat(String(v)) || def;
    };
    const gArr = (key: string): number[] => {
      const v = node[key];
      if (!v || String(v).trim() === '') return [];
      return String(v).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    };
    const gNumArr = (key: string): number[] => {
      const v = node[key];
      if (!v || String(v).trim() === '') return [];
      return String(v).split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    };

    return new BlockDefinition(
      id,
      String(node['@_name'] ?? ''),
      gn('@_icon'),
      gn('Hitpoints'),
      gn('Mass'),
      gn('Volume'),
      gn('Price'),
      String(g('Description')),
      gn('ArmorValue'),
      gb('Placable', true),
      gb('InShop', true),
      gb('Orientation', false),
      gb('CanActivate', false),
      gb('Deprecated', false),
      gn('BlockStyle'),
      gArr('SlabIds'),
      gArr('StyleIds'),
      gn('BlockComputerReference'),
      typeName,
      gArr('@_textureId'),
      gn('Slab'),
      gn('IndividualSides', 1),
      gb('SideTexturesPointToOrientation', false),
      gb('HasActivationTexture', false),
      gb('Animated', false),
      gb('Transparency', false),
      gb('LightSource', false),
      gNumArr('LightSourceColor'),
      gb('ExtendedTexture4x4', false),
    );
  }

  // ── Serialization XML ─────────────────────────────────────────────────────

  private static _toXml(blocks: BlockDefinition[]): string {
    const xmlObj = {
      Config: {
        Element: {
          General: {
            Custom: {
              Block: blocks.map(b => ({
                '@_type':              b.id,
                '@_name':              b.name,
                '@_icon':              b.icon,
                '@_textureId':         b.textureId.join(', '),
                Hitpoints:             b.hp,
                Mass:                  b.mass,
                Volume:                b.volume,
                Price:                 b.price,
                Description:           b.description,
                ArmorValue:            b.armor,
                Placable:              b.isPlacable,
                InShop:                b.inShop,
                Orientation:           b.hasOrientation,
                CanActivate:           b.canActivate,
                Deprecated:            b.isDeprecated,
                BlockStyle:            b.blockStyle,
                Slab:                  b.slab,
                IndividualSides:       b.individualSides,
                SideTexturesPointToOrientation: b.sideTexturesPointToOrientation,
                HasActivationTexture:  b.hasActivationTexture,
                Animated:              b.animated,
                Transparency:          b.transparency,
                LightSource:           b.lightSource,
                LightSourceColor:      b.lightSourceColor.join(','),
                ExtendedTexture4x4:    b.extendedTexture4x4,
                SlabIds:               b.slabIds.join(', '),
                StyleIds:              b.styleIds.join(', '),
                BlockComputerReference: b.computerReference,
              })),
            },
          },
        },
      },
    };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + XML_BUILDER.build(xmlObj);
  }

  toString(): string { return `BlockConfig(${this._byId.size} blocks)`; }
}
