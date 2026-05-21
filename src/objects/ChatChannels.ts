/**
 * @fileoverview Chat Channels
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * ChatChannels — business object for chatchannels.tag
 *
 * Structure (ChannelRouter.toTagStructure):
 *   STRUCT [
 *     BYTE   "VERSION" (= 0)
 *     STRUCT "CHANNELS" [
 *       STRUCT channel [   (toTagStructureServer)
 *         BYTE   version (= 2)
 *         STRING uid
 *         STRUCT mods     — STRING list
 *         STRUCT banned   — STRING list
 *         STRUCT muted    — STRING list
 *         STRING password
 *         BYTE   isPermanent
 *         BYTE   isPublic
 *       ]
 *       ...
 *       FINISH
 *     ]
 *     FINISH
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';

/**
 * Represents the ChatChannel model used by high-level StarMade object modelling.
 */
export class ChatChannel {
  /**
   * Creates a ChatChannel instance.
   *
   * @param uid - Input value for the constructor operation.
   * @param password - Input value for the constructor operation.
   * @param isPermanent - Input value for the constructor operation.
   * @param isPublic - Input value for the constructor operation.
   * @param moderators - Input value for the constructor operation.
   * @param banned - Input value for the constructor operation.
   * @param muted - Input value for the constructor operation.
   */
  constructor(
    public uid: string,
    public password: string,
    public isPermanent: boolean,
    public isPublic: boolean,
    public moderators: string[],
    public banned: string[],
    public muted: string[],
  ) {}

  /** Parses a channel STRUCT (server v2 format). */
  static fromTag(tag: Tag): ChatChannel {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 2;

    const uid = s[1]?.type === TagType.STRING ? s[1].getString() : '';

    const readStrList = (t: Tag | undefined): string[] => {
      if (!t || t.type !== TagType.STRUCT) return [];
      return t.getStruct().filter(c => c.type === TagType.STRING).map(c => c.getString());
    };

    let mods: string[], banned: string[], muted: string[], password: string, permanent: boolean, pub: boolean;

    if (version <= 1) {
      mods     = readStrList(s[2]);
      banned   = readStrList(s[3]);
      muted    = [];
      password = s[4]?.type === TagType.STRING ? s[4].getString() : '';
      permanent = s[5]?.type === TagType.BYTE ? s[5].getByte() > 0 : false;
      pub      = true;
    } else {
      mods     = readStrList(s[2]);
      banned   = readStrList(s[3]);
      muted    = readStrList(s[4]);
      password = s[5]?.type === TagType.STRING ? s[5].getString() : '';
      permanent = s[6]?.type === TagType.BYTE ? s[6].getByte() > 0 : false;
      pub      = s[7]?.type === TagType.BYTE ? s[7].getByte() > 0 : true;
    }

    return new ChatChannel(uid, password, permanent, pub, mods, banned, muted);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const toStrList = (arr: string[]): Tag =>
      new Tag(TagType.STRUCT, null, [...arr.map(s => Tags.string(null, s)), FINISH_TAG]);

    return Tags.struct(null, [
      Tags.byte(null, 2),                           // version
      Tags.string(null, this.uid),
      toStrList(this.moderators),
      toStrList(this.banned),
      toStrList(this.muted),
      Tags.string(null, this.password),
      Tags.byte(null, this.isPermanent ? 1 : 0),
      Tags.byte(null, this.isPublic ? 1 : 0),
    ]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `ChatChannel(uid="${this.uid}", permanent=${this.isPermanent}, public=${this.isPublic}, mods=${this.moderators.length})`;
  }
}

/**
 * Represents the ChatChannelManager model used by high-level StarMade object modelling.
 */
export class ChatChannelManager {
  /**
   * Creates a ChatChannelManager instance.
   *
   * @param version - Input value for the constructor operation.
   * @param channels - Input value for the constructor operation.
   */
  constructor(
    public version: number,
    public channels: ChatChannel[],
  ) {}

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Finds a matching value in high-level StarMade object modelling.
   *
   * @param uid - Input value for the find operation.
   * @returns The computed StarMade-Decoder value.
   */
  find(uid: string): ChatChannel | undefined {
    return this.channels.find(c => c.uid === uid);
  }

  /**
   * Handles the permanentChannels operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get permanentChannels(): ChatChannel[] { return this.channels.filter(c => c.isPermanent); }
  /**
   * Handles the publicChannels operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get publicChannels():   ChatChannel[] { return this.channels.filter(c => c.isPublic); }

  // ── Updates ──────────────────────────────────────────────────────────

  /**
   * Handles the addChannel operation used by high-level StarMade object modelling.
   *
   * @param ch - Input value for the addChannel operation.
   * @returns The computed StarMade-Decoder value.
   */
  addChannel(ch: ChatChannel): ChatChannelManager {
    return new ChatChannelManager(this.version, [...this.channels, ch]);
  }

  /**
   * Handles the removeChannel operation used by high-level StarMade object modelling.
   *
   * @param uid - Input value for the removeChannel operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeChannel(uid: string): ChatChannelManager {
    return new ChatChannelManager(this.version, this.channels.filter(c => c.uid !== uid));
  }

  /**
   * Handles the updateChannel operation used by high-level StarMade object modelling.
   *
   * @param uid - Input value for the updateChannel operation.
   * @param updated - Input value for the updateChannel operation.
   * @returns The computed StarMade-Decoder value.
   */
  updateChannel(uid: string, updated: ChatChannel): ChatChannelManager {
    return new ChatChannelManager(this.version, this.channels.map(c => c.uid === uid ? updated : c));
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): ChatChannelManager {
    if (root.type !== TagType.STRUCT) throw new TypeError('ChatChannelManager: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

    const version  = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    const channels: ChatChannel[] = [];

    const channelsStruct = s.find(t => t.name === 'CHANNELS' && t.type === TagType.STRUCT);
    if (channelsStruct) {
      for (const ch of channelsStruct.getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (ch.type === TagType.STRUCT) {
          try { channels.push(ChatChannel.fromTag(ch)); } catch { /* skip */ }
        }
      }
    }
    return new ChatChannelManager(version, channels);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const chanTags = [...this.channels.map(c => c.toTag()), FINISH_TAG];
    return Tags.struct(null, [
      Tags.byte('VERSION', this.version),
      new Tag(TagType.STRUCT, 'CHANNELS', chanTags),
    ]);
  }

  /** Encodes to binary for chatchannels.tag. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array): ChatChannelManager {
    return ChatChannelManager.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `ChatChannelManager(v${this.version}, ${this.channels.length} channels)`;
  }
}
