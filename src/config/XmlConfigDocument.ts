/** @fileoverview Internal XML document shared by configuration wrappers; paths never index JavaScript prototypes. */
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { DecodeError } from '../core/DecodeError.js';
import { formatLimits, formatBytes, formatText, checkEntryCount, rememberFormatSource, inheritFormatSource, formatOutput, type FormatLimits } from '../core/FormatLimits.js';

/** Scalar configuration values; unknown strings retain their spelling in the source tree. */
export type XmlConfigValue = string | number | boolean;
/** Ordered parser nodes preserve attributes, repeated elements, comments and CDATA. */
type XmlNode = Record<string, unknown>;
/** An optional sibling index distinguishes repeated element names. */
interface XmlPathPart { name: string; index?: number; }
/** Prefixing parser names avoids its special JavaScript-property handling; names are restored as own properties. */
const PARSER = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false,
  parseAttributeValue: false, trimValues: false, commentPropName: '#comment', cdataPropName: '#cdata',
  transformTagName: (name: string) => name.startsWith('$') ? name : `$${name}`,
  transformAttributeName: (name: string) => `$${name}` });
/** Ordered output retains every unedited XML node. */
const BUILDER = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, commentPropName: '#comment', cdataPropName: '#cdata' });
/** XML 1.0 character repertoire, including valid supplementary code points. */
const INVALID_XML_CHARACTER = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;

/** XML with immutable edits, explicit ambiguous paths and caller-selected byte/node budgets. */
export class XmlConfigDocument {
  readonly #tree: XmlNode[];
  readonly #limits: Required<FormatLimits>;

  /** Takes ownership of a private tree after checking all node counts and output bytes. */
  private constructor(tree: XmlNode[], limits: Required<FormatLimits>) {
    let count = 0;
    /** Counts all ordered nodes, including metadata text, before accepting the document. */
    const visit = (nodes: XmlNode[]): void => {
      for (const node of nodes) { checkEntryCount(++count, limits); visit(children(node)); }
    };
    visit(tree);
    this.#tree = tree; this.#limits = limits;
  }

  /** Parses validated XML without changing names or lexical values in unknown extensions. */
  static fromXml(xml: string, options: FormatLimits = {}): XmlConfigDocument {
    if (typeof xml !== 'string') throw new TypeError('Configuration XML must be a string');
    const limits = formatLimits(options), raw = formatBytes(xml, limits);
    if (INVALID_XML_CHARACTER.test(xml)) throw new DecodeError('E_FORMAT', 'Invalid XML character');
    if (/<!DOCTYPE/i.test(xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, ''))) throw new DecodeError('E_UNSUPPORTED', 'Configuration DTDs are not supported');
    if (xml.trim() && XMLValidator.validate(xml) !== true) throw new DecodeError('E_FORMAT', 'Invalid configuration XML');
    const tree = restoreNames(PARSER.parse(xml)) as XmlNode[];
    if (tree.filter(isElement).length > 1) throw new DecodeError('E_FORMAT', 'Configuration requires one XML root');
    const result = new XmlConfigDocument(tree, limits);
    rememberFormatSource(result, raw, Buffer.from(BUILDER.build(tree)));
    return result;
  }

  /** Reads an unambiguous dot path; escape literal dots in tag names as backslash-dot. */
  get(key: string): XmlConfigValue | undefined {
    const parts = pathParts(key);
    let nodes = this.#tree;
    for (const part of parts) {
      const matching = nodes.filter(node => nodeName(node) === part.name);
      if (part.index === undefined && matching.length > 1) throw new DecodeError('E_FORMAT', `Ambiguous XML path: ${key}`);
      const node = matching[part.index ?? 0];
      if (!node) return undefined;
      nodes = children(node);
    }
    if (nodes.some(isElement)) throw new TypeError(`XML path is a container: ${key}`);
    return scalar(textContent(nodes));
  }

  /** Detached scalar entries; repeated siblings use explicit zero-based indices such as Item[0]. */
  entries(): ReadonlyMap<string, XmlConfigValue> {
    const result = new Map<string, XmlConfigValue>();
    /** Walks unique element names, retaining escaped dot names in flat addresses. */
    const visit = (nodes: XmlNode[], prefix: string[]): void => {
      const names = new Map<string, number>(), groups = groupNodes(nodes);
      for (const node of nodes.filter(isElement)) {
        const name = nodeName(node), index = names.get(name) ?? 0;
        names.set(name, index + 1);
        const suffix = groups.get(name)!.length > 1 ? `[${index}]` : '';
        const parts = [...prefix, name.replaceAll('.', '\\.') + suffix], nested = children(node);
        if (nested.some(isElement)) visit(nested, parts);
        else result.set(parts.join('.'), scalar(textContent(nested)));
      }
    };
    visit(this.#tree, []);
    return result;
  }

  /** Edits one scalar while preserving sibling nodes, leaf attributes and comments. */
  set(key: string, value: XmlConfigValue): XmlConfigDocument {
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('XML config value must be a string, finite number or boolean');
    }
    if (INVALID_XML_CHARACTER.test(String(value))) throw new TypeError('Invalid XML value character');
    const parts = pathParts(key);
    if (this.get(key) === value) return this;
    const tree = structuredClone(this.#tree);
    let nodes = tree;
    for (const [index, part] of parts.entries()) {
      let node = nodes.filter(candidate => nodeName(candidate) === part.name)[part.index ?? 0];
      if (!node) {
        if (part.index !== undefined) throw new RangeError('XML sibling index does not exist');
        if (index === 0 && nodes.some(isElement)) throw new TypeError('Cannot add a second XML root');
        if (nodes.some(candidate => nodeName(candidate) === '#text' && textContent([candidate]).trim())) {
          throw new TypeError('Cannot replace scalar text with an XML container');
        }
        node = { [part.name]: [] }; nodes.push(node);
      }
      nodes = children(node);
    }
    const retained = nodes.filter(node => nodeName(node) !== '#text' && nodeName(node) !== '#cdata');
    nodes.splice(0, nodes.length, { '#text': String(value) }, ...retained);
    const result = inheritFormatSource(this, new XmlConfigDocument(tree, this.#limits));
    result.toXml();
    return result;
  }

  /** Applies a complete custom XML overlay, preserving unknown elements and attributes. */
  merge(custom: XmlConfigDocument): XmlConfigDocument {
    const root = this.#tree.find(isElement), customRoot = custom.#tree.find(isElement);
    if (root && customRoot && nodeName(root) !== nodeName(customRoot)) throw new TypeError('XML overlay root does not match');
    const result = inheritFormatSource(this, new XmlConfigDocument(mergeNodes(this.#tree, custom.#tree), this.#limits));
    result.toXml();
    return result;
  }

  /** Complete export in memory; an unchanged or reverted document retains its original bytes. */
  toXml(): string {
    return formatText(formatOutput(this, Buffer.from(BUILDER.build(this.#tree)), this.#limits));
  }

  /** Minimal changed subtrees, retaining their attributes; empty means no output is necessary. */
  difference(vanilla: XmlConfigDocument): string {
    return formatText(formatBytes(BUILDER.build(differenceNodes(this.#tree, vanilla.#tree)), this.#limits));
  }
}

/** Returns the sole ordered node name, excluding its attribute bundle. */
function nodeName(node: XmlNode): string { return Object.keys(node).find(key => key !== ':@')!; }
/** Identifies XML elements, excluding text, comments, declarations and processing instructions. */
function isElement(node: XmlNode): boolean { return !/^[#?]/.test(nodeName(node)); }
/** Text nodes have scalar payloads; other ordered nodes carry child arrays. */
function children(node: XmlNode): XmlNode[] {
  const value = node[nodeName(node)]; return Array.isArray(value) ? value : [];
}
/** Restores parser-prefixed names using own-property construction, never prototype assignment. */
function restoreNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreNames);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key.startsWith('$') ? key.slice(1) : key, restoreNames(item)]));
  return value;
}
/** Validates names before creating XML; the legacy attributed-leaf .#text suffix remains accepted. */
function pathParts(key: string): XmlPathPart[] {
  if (typeof key !== 'string' || !key) throw new TypeError('XML path must be a nonempty string');
  return key.replace(/\.#text$/, '').split(/(?<!\\)\./).map(part => {
    const match = /^(.*)\[(\d+)\]$/.exec(part);
    const name = (match ? match[1] : part).replaceAll('\\.', '.');
    const index = match ? Number(match[2]) : undefined;
    if (!name || /[\s<>/'"=\\]/.test(name) || XMLValidator.validate(`<${name}/>` ) !== true) throw new TypeError(`Invalid XML path component: ${name}`);
    if (index !== undefined && !Number.isSafeInteger(index)) throw new RangeError('Invalid XML sibling index');
    return { name, index };
  });
}
/** Concatenates text and CDATA without treating comments as configuration values. */
function textContent(nodes: XmlNode[]): string {
  return nodes.map(node => nodeName(node) === '#text' ? String(node['#text'])
    : nodeName(node) === '#cdata' ? textContent(children(node)) : '').join('');
}
/** Preserves exact text in the tree while exposing safely representable primitive values. */
function scalar(text: string): XmlConfigValue {
  const value = text.trim();
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))) return number;
  }
  return value;
}
/** Indexes siblings once, retaining node order within each name group. */
function groupNodes(nodes: XmlNode[]): Map<string, XmlNode[]> {
  const groups = new Map<string, XmlNode[]>();
  for (const node of nodes) {
    const name = nodeName(node), group = groups.get(name);
    if (group) group.push(node); else groups.set(name, [node]);
  }
  return groups;
}

/** Overlays unique nodes recursively; repeated groups are replaced together, never collapsed. */
function mergeNodes(base: XmlNode[], custom: XmlNode[]): XmlNode[] {
  const incoming = groupNodes(custom), original = groupNodes(base), handled = new Set<string>(), output: XmlNode[] = [];
  /** Creates the replacement group, merging metadata and unique descendant nodes. */
  const replacement = (name: string): XmlNode[] => {
    const group = incoming.get(name)!, existing = original.get(name);
    if (group.length === 1 && existing?.length === 1 && isElement(group[0])) {
      const nested = children(group[0]);
      return [{ [name]: nested.some(isElement) ? mergeNodes(children(existing[0]), nested) : structuredClone(nested),
        ':@': { ...existing[0][':@'] as object, ...group[0][':@'] as object } }];
    }
    return structuredClone(group);
  };
  for (const node of base) {
    const name = nodeName(node);
    if (!incoming.has(name)) output.push(structuredClone(node));
    else if (!handled.has(name)) { output.push(...replacement(name)); handled.add(name); }
  }
  for (const name of incoming.keys()) if (!handled.has(name)) output.push(...replacement(name));
  return output;
}

/** Keeps changed groups in source order and only changed descendants of unique containers. */
function differenceNodes(current: XmlNode[], baseline: XmlNode[]): XmlNode[] {
  const result: XmlNode[] = [], groups = groupNodes(current), original = groupNodes(baseline), changed = new Set<string>();
  for (const [name, group] of groups) if (JSON.stringify(group) !== JSON.stringify(original.get(name))) changed.add(name);
  for (const node of current) {
    const name = nodeName(node), before = original.get(name);
    if (!changed.has(name)) continue;
    if (groups.get(name)!.length === 1 && before?.length === 1 && children(node).some(isElement)) {
      result.push({ ...node, [name]: differenceNodes(children(node), children(before[0])) });
    } else result.push(node);
  }
  return result;
}
