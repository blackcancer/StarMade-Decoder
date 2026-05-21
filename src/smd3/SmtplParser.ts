/**
 * @fileoverview StarMade Template Parser
 *
 * Decodes .smtpl template files into block pieces, connections, and text metadata.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmtplParser — parser for .smtpl files (StarMade block templates)
 *
 * Format binaire (CopyArea.java) :
 *   byte    version     (VERSION = 6 current)
 *
 *   Version >= 6 (4-byte data par bloc) :
 *     int   minX, minY, minZ
 *     int   maxX, maxY, maxZ
 *     int   piecesSize
 *     [piecesSize × VoidSegmentPiece] :
 *       int   voidX, voidY, voidZ
 *       int   data    (SegmentData4Byte : bits 0-12=type, 13-19=hp, 20=active, 21-25=orient)
 *     int   connectionsSize
 *       long key + int lSize + lSize×long
 *     int   textSize
 *       long key + UTF  text
 *     int   filterSize
 *       long key + int lSize + lSize×(short+int)
 *     int   prodSize
 *       long key + short value
 *     int   prodLimitSize
 *       long key + int value
 *     int   fillUpFilterSize
 *       long key + int lSize + lSize×(short+int)
 *
 *   Versions <= 5 (3-byte data par bloc) :
 *     min/max puis piecesSize×(3×int voidPos + 3×byte data)
 *     followed by the same connections/text/filter/prod sections
 *
 * Java source: CopyArea.java, VoidSegmentPiece.java, SegmentPiece.java
 */

import { BufferReader } from '../core/BufferReader.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemplatePiece {
  x: number; y: number; z: number;
  type: number;
  hp: number;
  active: boolean;
  orientation: number;
}

export interface TemplateConnection {
  from: bigint;
  targets: bigint[];
}

export interface TemplatePosition {
  x: number; y: number; z: number;
}

export interface TemplateFilterEntry {
  type: number;
  count: number;
}

export interface TemplateInventoryFilter {
  position: bigint;
  entries: TemplateFilterEntry[];
}

export interface TemplateProductionEntry {
  position: bigint;
  type: number;
}

export interface TemplateProductionLimit {
  position: bigint;
  limit: number;
}

export interface SmtplFileInput {
  version: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  pieces: TemplatePiece[];
  connections: TemplateConnection[];
  texts: Map<bigint, string>;
  filters?: TemplateInventoryFilter[];
  production?: TemplateProductionEntry[];
  productionLimits?: TemplateProductionLimit[];
  fillUpFilters?: TemplateInventoryFilter[];
}

export interface SmtplFile extends SmtplFileInput {
  /** Copied area dimensions */
  sizeX: number; sizeY: number; sizeZ: number;
  /** Texts associated with positions (panels, etc.) */
  texts: Map<bigint, string>;
  filters: TemplateInventoryFilter[];
  production: TemplateProductionEntry[];
  productionLimits: TemplateProductionLimit[];
  fillUpFilters: TemplateInventoryFilter[];
  totalBlocks: number;
}

export class BlueprintTemplate implements SmtplFile {
  version: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  pieces: TemplatePiece[];
  connections: TemplateConnection[];
  texts: Map<bigint, string>;
  filters: TemplateInventoryFilter[];
  production: TemplateProductionEntry[];
  productionLimits: TemplateProductionLimit[];
  fillUpFilters: TemplateInventoryFilter[];

  constructor(input: SmtplFileInput) {
    this.version = input.version;
    this.minX = input.minX; this.minY = input.minY; this.minZ = input.minZ;
    this.maxX = input.maxX; this.maxY = input.maxY; this.maxZ = input.maxZ;
    this.pieces = input.pieces.map(cloneTemplatePiece);
    this.connections = input.connections.map(cloneTemplateConnection);
    this.texts = new Map(input.texts);
    this.filters = cloneTemplateFilters(input.filters ?? []);
    this.production = (input.production ?? []).map(entry => ({ ...entry }));
    this.productionLimits = (input.productionLimits ?? []).map(entry => ({ ...entry }));
    this.fillUpFilters = cloneTemplateFilters(input.fillUpFilters ?? []);
  }

  get sizeX(): number { return this.maxX - this.minX + 1; }
  get sizeY(): number { return this.maxY - this.minY + 1; }
  get sizeZ(): number { return this.maxZ - this.minZ + 1; }
  get totalBlocks(): number { return this.pieces.length; }
  get pieceCount(): number { return this.pieces.length; }
  get connectionCount(): number { return this.connections.reduce((sum, c) => sum + c.targets.length, 0); }
  get textCount(): number { return this.texts.size; }
  get filterCount(): number { return this.filters.length; }
  get productionCount(): number { return this.production.length; }
  get productionLimitCount(): number { return this.productionLimits.length; }
  get fillUpFilterCount(): number { return this.fillUpFilters.length; }
  get isEmpty(): boolean { return this.pieces.length === 0; }

  get bounds(): { min: TemplatePosition; max: TemplatePosition; size: TemplatePosition } {
    return {
      min: { x: this.minX, y: this.minY, z: this.minZ },
      max: { x: this.maxX, y: this.maxY, z: this.maxZ },
      size: { x: this.sizeX, y: this.sizeY, z: this.sizeZ },
    };
  }

  pieceAt(position: TemplatePosition): TemplatePiece | null {
    return this.pieces.find(piece => sameTemplatePosition(piece, position)) ?? null;
  }

  piecesOfType(type: number): TemplatePiece[] {
    return this.pieces.filter(piece => piece.type === type).map(cloneTemplatePiece);
  }

  blockCountOf(type: number): number {
    return this.pieces.reduce((count, piece) => count + (piece.type === type ? 1 : 0), 0);
  }

  topBlockTypes(limit = 10): TemplateFilterEntry[] {
    const counts = new Map<number, number>();
    for (const piece of this.pieces) {
      counts.set(piece.type, (counts.get(piece.type) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getText(position: TemplatePosition | bigint): string | null {
    return this.texts.get(templatePositionInputKey(position)) ?? null;
  }

  filterAt(position: TemplatePosition | bigint): TemplateInventoryFilter | null {
    const key = templatePositionInputKey(position);
    const filter = this.filters.find(entry => entry.position === key);
    return filter ? cloneTemplateFilter(filter) : null;
  }

  fillUpFilterAt(position: TemplatePosition | bigint): TemplateInventoryFilter | null {
    const key = templatePositionInputKey(position);
    const filter = this.fillUpFilters.find(entry => entry.position === key);
    return filter ? cloneTemplateFilter(filter) : null;
  }

  productionAt(position: TemplatePosition | bigint): TemplateProductionEntry | null {
    const key = templatePositionInputKey(position);
    const entry = this.production.find(item => item.position === key);
    return entry ? { ...entry } : null;
  }

  productionLimitAt(position: TemplatePosition | bigint): TemplateProductionLimit | null {
    const key = templatePositionInputKey(position);
    const entry = this.productionLimits.find(item => item.position === key);
    return entry ? { ...entry } : null;
  }

  controllersFor(target: TemplatePosition | bigint): TemplatePosition[] {
    const key = templatePositionInputKey(target);
    const connection = this.connections.find(entry => entry.from === key);
    return connection ? connection.targets.map(templatePositionFromKey) : [];
  }

  controlledBy(controller: TemplatePosition | bigint): TemplatePosition[] {
    const key = templatePositionInputKey(controller);
    return this.connections
      .filter(connection => connection.targets.some(target => target === key))
      .map(connection => templatePositionFromKey(connection.from));
  }

  isConnected(controller: TemplatePosition | bigint, target: TemplatePosition | bigint): boolean {
    const controllerKey = templatePositionInputKey(controller);
    const targetKey = templatePositionInputKey(target);
    return this.connections.some(connection =>
      connection.from === targetKey && connection.targets.some(value => value === controllerKey)
    );
  }

  withPieces(pieces: TemplatePiece[]): BlueprintTemplate {
    return new BlueprintTemplate({ ...this, pieces });
  }

  withPiece(piece: TemplatePiece): BlueprintTemplate {
    const pieces = this.pieces.filter(existing => !sameTemplatePosition(existing, piece));
    pieces.push(cloneTemplatePiece(piece));
    return this.withPieces(pieces);
  }

  removePieceAt(position: TemplatePosition): BlueprintTemplate {
    return this.withPieces(this.pieces.filter(piece => !sameTemplatePosition(piece, position)));
  }

  withConnections(connections: TemplateConnection[]): BlueprintTemplate {
    return new BlueprintTemplate({ ...this, connections });
  }

  addConnection(controller: TemplatePosition | bigint, target: TemplatePosition | bigint): BlueprintTemplate {
    const controllerKey = templatePositionInputKey(controller);
    const targetKey = templatePositionInputKey(target);
    const connections = this.connections.map(cloneTemplateConnection);
    const entry = connections.find(connection => connection.from === targetKey);
    if (entry) {
      if (!entry.targets.some(value => value === controllerKey)) {
        entry.targets.push(controllerKey);
      }
    } else {
      connections.push({ from: targetKey, targets: [controllerKey] });
    }
    return this.withConnections(connections);
  }

  removeConnection(controller: TemplatePosition | bigint, target?: TemplatePosition | bigint): BlueprintTemplate {
    const controllerKey = templatePositionInputKey(controller);
    const targetKey = target === undefined ? null : templatePositionInputKey(target);
    const connections = this.connections
      .map(connection => targetKey === null || connection.from === targetKey
        ? { from: connection.from, targets: connection.targets.filter(value => value !== controllerKey) }
        : cloneTemplateConnection(connection)
      )
      .filter(connection => connection.targets.length > 0);
    return this.withConnections(connections);
  }

  withText(position: TemplatePosition | bigint, text: string): BlueprintTemplate {
    const texts = new Map(this.texts);
    texts.set(templatePositionInputKey(position), text);
    return new BlueprintTemplate({ ...this, texts });
  }

  withoutText(position: TemplatePosition | bigint): BlueprintTemplate {
    const texts = new Map(this.texts);
    texts.delete(templatePositionInputKey(position));
    return new BlueprintTemplate({ ...this, texts });
  }

  withInventoryFilter(position: TemplatePosition | bigint, entries: TemplateFilterEntry[]): BlueprintTemplate {
    return new BlueprintTemplate({
      ...this,
      filters: upsertTemplateFilter(this.filters, templatePositionInputKey(position), entries),
    });
  }

  withFillUpFilter(position: TemplatePosition | bigint, entries: TemplateFilterEntry[]): BlueprintTemplate {
    return new BlueprintTemplate({
      ...this,
      fillUpFilters: upsertTemplateFilter(this.fillUpFilters, templatePositionInputKey(position), entries),
    });
  }

  withProduction(position: TemplatePosition | bigint, type: number | null): BlueprintTemplate {
    const key = templatePositionInputKey(position);
    const production = this.production.filter(entry => entry.position !== key);
    if (type !== null) {
      production.push({ position: key, type });
    }
    return new BlueprintTemplate({ ...this, production });
  }

  withProductionLimit(position: TemplatePosition | bigint, limit: number | null): BlueprintTemplate {
    const key = templatePositionInputKey(position);
    const productionLimits = this.productionLimits.filter(entry => entry.position !== key);
    if (limit !== null) {
      productionLimits.push({ position: key, limit });
    }
    return new BlueprintTemplate({ ...this, productionLimits });
  }
}

// ── Parser principal ──────────────────────────────────────────────────────────

export function parseSmtpl(data: Buffer | Uint8Array): SmtplFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const version = r.readInt8();

  let minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0;
  const pieces: TemplatePiece[] = [];
  const connections: TemplateConnection[] = [];
  const texts = new Map<bigint, string>();
  const filters: TemplateInventoryFilter[] = [];
  const production: TemplateProductionEntry[] = [];
  const productionLimits: TemplateProductionLimit[] = [];
  const fillUpFilters: TemplateInventoryFilter[] = [];

  if (version >= 6) {
    // Current 4-byte format
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const data4 = r.readInt32BE();
      pieces.push(_decode4BytePiece(vx, vy, vz, data4));
    }

    _readConnections(r, connections);
    _readTexts(r, texts);
    filters.push(..._readFilters(r));              // filterSize + entries
    production.push(..._readProdMap(r));           // prodSize + entries (long->short)
    productionLimits.push(..._readProdLimitMap(r)); // prodLimitSize + entries (long->int)
    fillUpFilters.push(..._readFilters(r));        // fillUpFilterSize + entries

  } else if (version >= 4) {
    // Format 3-byte pieces, same structure
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const b0 = r.readInt8(), b1 = r.readInt8(), b2 = r.readInt8();
      pieces.push(_decode3BytePiece(vx, vy, vz, b0, b1, b2));
    }

    _readConnections(r, connections);
    _readTexts(r, texts);
    filters.push(..._readFilters(r));
    production.push(..._readProdMap(r));
    if (version >= 5) {
      productionLimits.push(..._readProdLimitMap(r));
      fillUpFilters.push(..._readFilters(r));
    }

  } else {
    // Very old versions (1-3) — same structure 3-byte but without prod/filter
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const b0 = r.readInt8(), b1 = r.readInt8(), b2 = r.readInt8();
      pieces.push(_decode3BytePiece(vx, vy, vz, b0, b1, b2));
    }

    if (!r.isEOF()) _readConnections(r, connections);
    if (version >= 2 && !r.isEOF()) _readTexts(r, texts);
    if (version >= 3 && !r.isEOF()) {
      filters.push(..._readFilters(r));
      production.push(..._readProdMap(r));
    }
  }

  return new BlueprintTemplate({
    version,
    minX, minY, minZ, maxX, maxY, maxZ,
    pieces,
    connections,
    texts,
    filters,
    production,
    productionLimits,
    fillUpFilters,
  });
}

// ── Block decoding ─────────────────────────────────────────────────────────────

function _decode4BytePiece(x: number, y: number, z: number, data: number): TemplatePiece {
  return {
    x, y, z,
    type:        data & 0x1FFF,
    hp:          (data >> 13) & 0x7F,
    active:      ((data >> 20) & 0x1) === 1,
    orientation: (data >> 21) & 0x1F,
  };
}

function _decode3BytePiece(x: number, y: number, z: number, b0: number, b1: number, b2: number): TemplatePiece {
  const u0 = b0 & 0xff, u1 = b1 & 0xff, u2 = b2 & 0xff;
  const type        = u2 + ((u1 & 0x07) * 256);
  const hp          = ((u1 & 0xf8) >> 3) | ((u0 & 0x03) << 5);
  const active      = (u0 & 0x08) === 0;
  const orientation = (u0 >> 4) & 0x0f;
  return { x, y, z, type, hp, active, orientation };
}

// ── Sections communes ─────────────────────────────────────────────────────────

function _readConnections(r: BufferReader, out: TemplateConnection[]): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    const key   = r.readInt64BE();
    const lSize = r.readInt32BE();
    const targets: bigint[] = [];
    for (let j = 0; j < lSize; j++) targets.push(r.readInt64BE());
    out.push({ from: key, targets });
  }
}

function _readTexts(r: BufferReader, out: Map<bigint, string>): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    const key  = r.readInt64BE();
    const text = r.readJavaModifiedUTF();
    out.set(key, text);
  }
}

function _readFilters(r: BufferReader): TemplateInventoryFilter[] {
  if (r.isEOF()) return [];
  const filters: TemplateInventoryFilter[] = [];
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    const position = r.readInt64BE();
    const lSize = r.readInt32BE();
    const entries: TemplateFilterEntry[] = [];
    for (let j = 0; j < lSize; j++) {
      entries.push({
        type: r.readInt16BE(),
        count: r.readInt32BE(),
      });
    }
    filters.push({ position, entries });
  }
  return filters;
}

function _readProdMap(r: BufferReader): TemplateProductionEntry[] {
  if (r.isEOF()) return [];
  const entries: TemplateProductionEntry[] = [];
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    entries.push({
      position: r.readInt64BE(),
      type: r.readInt16BE(),
    });
  }
  return entries;
}

function _readProdLimitMap(r: BufferReader): TemplateProductionLimit[] {
  if (r.isEOF()) return [];
  const entries: TemplateProductionLimit[] = [];
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    entries.push({
      position: r.readInt64BE(),
      limit: r.readInt32BE(),
    });
  }
  return entries;
}

export function normalizeBlueprintTemplate(file: BlueprintTemplate | SmtplFileInput): BlueprintTemplate {
  return file instanceof BlueprintTemplate ? file : new BlueprintTemplate(file);
}

export function templatePositionKey(position: TemplatePosition): bigint {
  return (BigInt(position.z & 0xffff) << 32n)
    + (BigInt(position.y & 0xffff) << 16n)
    + BigInt(position.x & 0xffff);
}

export function templatePositionFromKey(key: bigint): TemplatePosition {
  return {
    x: signed16(Number(key & 0xffffn)),
    y: signed16(Number((key >> 16n) & 0xffffn)),
    z: signed16(Number((key >> 32n) & 0xffffn)),
  };
}

function templatePositionInputKey(position: TemplatePosition | bigint): bigint {
  return typeof position === 'bigint' ? position : templatePositionKey(position);
}

function signed16(value: number): number {
  return value >= 0x8000 ? value - 0x10000 : value;
}

function sameTemplatePosition(left: TemplatePosition, right: TemplatePosition): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function cloneTemplatePiece(piece: TemplatePiece): TemplatePiece {
  return { ...piece };
}

function cloneTemplateConnection(connection: TemplateConnection): TemplateConnection {
  return { from: connection.from, targets: [...connection.targets] };
}

function cloneTemplateFilter(filter: TemplateInventoryFilter): TemplateInventoryFilter {
  return {
    position: filter.position,
    entries: filter.entries.map(entry => ({ ...entry })),
  };
}

function cloneTemplateFilters(filters: TemplateInventoryFilter[]): TemplateInventoryFilter[] {
  return filters.map(cloneTemplateFilter);
}

function upsertTemplateFilter(
  filters: TemplateInventoryFilter[],
  position: bigint,
  entries: TemplateFilterEntry[]
): TemplateInventoryFilter[] {
  const next = filters.filter(filter => filter.position !== position).map(cloneTemplateFilter);
  if (entries.length > 0) {
    next.push({
      position,
      entries: entries.map(entry => ({ ...entry })),
    });
  }
  return next;
}
