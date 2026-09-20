/** @fileoverview Bounded blueprint hierarchy and live access to each entity's stored blocks. */
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import type { BlockConfig } from '../config/BlockConfig.js';
import type { BlueprintArchive, SmentEntity } from './SmentParser.js';
import { BlockVolume } from './BlockVolume.js';

/** Explicit catalogue and hierarchy limits for one blueprint model. */
export interface BlueprintModelOptions {
  config?: Pick<BlockConfig, 'getById'>;
  maxEntities?: number;
  maxDepth?: number;
  maxSegments?: number;
}

/** One entity retains its own grid; attachment offsets alone do not represent a full rail transform. */
export class BlueprintNode {
  /** Captures the current path; obtain nodes again after changing the hierarchy. */
  constructor(readonly path: string, readonly parentPath: string | null,
    readonly entity: SmentEntity, readonly blocks: BlockVolume) {}
  /** JSON-safe stored blocks, retaining entity identity and the decoded offset separately. */
  toJSON(): { path: string; parentPath: string | null; name: string;
    offset: { x: number; y: number; z: number }; blocks: ReturnType<import('./PlacedBlock.js').PlacedBlock['toJSON']>[] } {
    return { path: this.path, parentPath: this.parentPath, name: this.entity.name,
      offset: { ...this.entity.offset }, blocks: [...this.blocks.entries()].map(block => block.toJSON()) };
  }
}

/** An instance-scoped hierarchy over existing models; edits flow through to their document writers. */
export class BlueprintModel {
  private readonly maximum: number;
  private readonly depth: number;
  private readonly segmentMaximum: number;
  private readonly config?: Pick<BlockConfig, 'getById'>;
  /** The optional volume factory allows a document to retain original empty-region identities. */
  constructor(readonly archive: BlueprintArchive, options: BlueprintModelOptions = {},
    private readonly volume?: (entity: SmentEntity) => BlockVolume) {
    this.maximum = boundedInteger(options.maxEntities ?? 1024, 'maxEntities');
    this.depth = boundedInteger(options.maxDepth ?? 64, 'maxDepth', 256);
    this.segmentMaximum = boundedInteger(options.maxSegments ?? 512, 'maxSegments');
    this.config = options.config;
  }
  /** Builds a fresh bounded hierarchy, rejecting cycles, duplicate paths and incomplete data. */
  nodes(): BlueprintNode[] {
    if (this.archive.diagnostics.length) throw new DecodeError('E_INCOMPLETE', 'Blueprint models require a complete blueprint');
    const nodes: BlueprintNode[] = [], seen = new Set<SmentEntity>(), paths = new Set<string>();
    const pending: { entity: SmentEntity; parent: string | null; depth: number }[] = [{ entity: this.archive.root, parent: null, depth: 0 }];
    let segments = 0;
    while (pending.length) {
      const current = pending.pop()!, entity = current.entity;
      if (current.depth > this.depth || nodes.length >= this.maximum) throw new DecodeError('E_LIMIT', 'Blueprint hierarchy limit exceeded');
      if (!entity.name || entity.name === '.' || entity.name === '..' || /[\\/\0:]/.test(entity.name)) throw new DecodeError('E_FORMAT', 'Invalid blueprint entity name');
      const path = current.parent === null ? entity.name : `${current.parent}/${entity.name}`;
      if (seen.has(entity) || paths.has(path)) throw new DecodeError('E_FORMAT', 'Cyclic or duplicate blueprint entity');
      seen.add(entity); paths.add(path);
      const volume = this.volume ? this.volume(entity) : new BlockVolume(entity.segments, { config: this.config, maxSegments: this.segmentMaximum });
      segments += volume.segmentCount;
      if (segments > this.segmentMaximum) throw new DecodeError('E_LIMIT', 'Blueprint segment budget exceeded');
      nodes.push(new BlueprintNode(path, current.parent, entity, volume));
      if (nodes.length + pending.length + entity.children.length > this.maximum) throw new DecodeError('E_LIMIT', 'Blueprint hierarchy limit exceeded');
      for (let index = entity.children.length - 1; index >= 0; index--) pending.push({ entity: entity.children[index], parent: path, depth: current.depth + 1 });
    }
    return nodes;
  }
  /** Resolves by full path so repeated ATTACHED_0 names in different branches remain unambiguous. */
  find(path: string): BlueprintNode | undefined { return this.nodes().find(node => node.path === path); }
  /** Current non-air block count across every attached entity. */
  get blockCount(): number { return this.nodes().reduce((sum, node) => sum + node.blocks.blockCount, 0); }
  /** Sparse JSON-safe hierarchy; raw rail metadata remains available on each entity. */
  toJSON(): ReturnType<BlueprintNode['toJSON']>[] { return this.nodes().map(node => node.toJSON()); }
}
