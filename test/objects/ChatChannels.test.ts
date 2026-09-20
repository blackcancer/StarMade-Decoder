/** @fileoverview Server channel schemas, strict immutable edits and preserved file envelopes. */
import fs from 'node:fs';
import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { Tag } from '../../src/core/Tag.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { TagType } from '../../src/core/TagType.js';
import { readFrom, readTagDocument, writeTo } from '../../src/core/TagParser.js';
import { ChatChannel, ChatChannelManager } from '../../src/objects/ChatChannels.js';

/** Independent server layout from ChatChannel.loadServerChannel/toServerTag. */
function channel(version = 2, uid = 'saved'): Tag {
  const list = (name: string, value: string) => Tags.struct(name, [Tags.string('memberName', value)]);
  return Tags.struct('recordName', [Tags.byte('recordVersion', version), Tags.string('uid', uid),
    list('mods', 'Admin'), list('bans', 'Bad'), ...(version >= 2 ? [list('mutes', 'Muted')] : []),
    Tags.string('password', 'NUL\0🚀'), Tags.byte('permanent', 2),
    ...(version >= 2 ? [Tags.byte('public', -1)] : []), Tags.byteArray('recordExtension', [0, 255])]);
}
/** Router fields are positional even when the CHANNELS field is anonymous. */
function manager(records = [channel()], named = true): Tag {
  return Tags.struct('routerName', [Tags.byte('VERSION', 0), Tags.struct(named ? 'CHANNELS' : null, records),
    Tags.long('rootExtension', 9007199254740993n)]);
}

describe('ChatChannels V2 — faithful server archives', () => {
  it('preserves all supported server versions, names, flag encodings and unknown extensions', () => {
    for (const version of [0, 1, 2]) {
      const source = channel(version), parsed = ChatChannel.fromTag(source);
      assert.equal(parsed.version, version); assert.equal(parsed.uid, 'saved');
      assert.equal(parsed.password, 'NUL\0🚀'); assert.equal(parsed.isPermanent, true);
      assert.equal(parsed.isPublic, version < 2); assert.deepEqual(parsed.moderators, ['Admin']);
      assert.deepEqual(parsed.banned, ['Bad']); assert.deepEqual(parsed.muted, version < 2 ? [] : ['Muted']);
      assert.deepEqual(writeTo(parsed.toTag()), writeTo(source));
      const changed = parsed.with({ password: 'changed', moderators: ['Admin', 'New'] });
      const output = changed.toTag();
      assert.equal(output.findByName('recordExtension')!.getByteArray()[1], 255);
      assert.equal(output.findByName('mods')!.getStruct()[0].name, 'memberName');
      assert.equal(output.findByName('permanent')!.getByte(), 2);
      assert.equal(ChatChannel.fromTag(output).password, 'changed');
      assert.equal(ChatChannel.fromTag(output).version, version);
      assert.equal(parsed.password, 'NUL\0🚀');
    }
  });

  it('reads positional router fields and preserves records across add, replace, rename and remove', () => {
    for (const named of [true, false]) {
      const source = manager([channel()], named), parsed = ChatChannelManager.fromTag(source);
      assert.equal(parsed.channels.length, 1); assert.deepEqual(writeTo(parsed.toTag()), writeTo(source));
      const other = new ChatChannel('other', '', false, true, [], [], []);
      const added = parsed.addChannel(other);
      const changed = added.updateChannel('saved', new ChatChannel('renamed', 'replacement', false, true, [], [], []));
      assert.equal(changed.find('saved'), undefined); assert.equal(changed.find('renamed')!.password, 'replacement');
      assert.equal(changed.find('other')!.password, '');
      assert.ok(changed.toTag().findByName('recordExtension')); assert.ok(changed.toTag().findByName('rootExtension'));
      assert.equal(changed.toTag().getStruct()[1].name, named ? 'CHANNELS' : null);
      assert.deepEqual(added.permanentChannels.map(c => c.uid), ['saved']);
      assert.deepEqual(added.publicChannels.map(c => c.uid), ['other']);
      assert.equal(changed.removeChannel('renamed').channels.length, 1);
      assert.equal(changed.removeChannel('absent').channels.length, 2);
      assert.equal(parsed.channels.length, 1); assert.match(changed.toString(), /2 channels/);
      assert.match(changed.find('renamed')!.toString(), /renamed/);
    }
  });

  it('detaches constructor arrays, parsed Tags, returned lists and all immutable edits', () => {
    const moderators = ['Admin'], banned = ['Bad'], muted = ['Muted'];
    const record = new ChatChannel('saved', 'pw', true, true, moderators, banned, muted);
    const channels = [record], archive = new ChatChannelManager(0, channels);
    moderators.push('external'); banned.length = 0; muted[0] = 'external'; channels.length = 0;
    record.moderators.push('returned'); record.banned.length = 0; record.muted.length = 0; archive.channels.length = 0;
    assert.deepEqual(record.moderators, ['Admin']); assert.deepEqual(record.banned, ['Bad']); assert.deepEqual(record.muted, ['Muted']);
    assert.equal(archive.channels.length, 1);
    const changed = archive.addChannel(record.with({ uid: 'second' }));
    assert.throws(() => { (changed.channels[0] as any).password = 'mutation'; }, TypeError);
    assert.equal(archive.channels[0].password, 'pw');
    const root = manager(), before = writeTo(root), parsed = ChatChannelManager.fromTag(root);
    root.findByName('recordExtension')!.getByteArray()[0] = 7;
    parsed.toTag().findByName('recordExtension')!.getByteArray()[0] = 9;
    assert.deepEqual(writeTo(parsed.toTag()), before);
  });

  it('retains duplicate moderation entries and their separate names when lists are extended', () => {
    const root = channel();
    root.getStruct()[2] = Tags.struct('mods', [Tags.string('first', 'Admin'), Tags.string('second', 'Admin')]);
    const parsed = ChatChannel.fromTag(root), changed = parsed.with({ moderators: ['Admin', 'Admin', 'Admin', 'New'] });
    const members = changed.toTag().findByName('mods')!.getStruct().filter(tag => tag.type !== TagType.FINISH);
    assert.deepEqual(members.map(tag => tag.name), ['first', 'second', null, null]);
    assert.deepEqual(members.map(tag => tag.getString()), ['Admin', 'Admin', 'Admin', 'New']);
    assert.deepEqual(parsed.moderators, ['Admin', 'Admin']);
  });

  it('retains original plain/GZIP bytes and trailing data on no-op and edited output', () => {
    const plain = writeTo(manager()); plain.writeInt16BE(17, 0);
    for (const original of [Buffer.concat([plain, Buffer.from([0xaa, 0xbb])]),
      gzipSync(Buffer.concat([plain.subarray(2), Buffer.from([0xaa, 0xbb])]))]) {
      const input = new Uint8Array(original), parsed = ChatChannelManager.fromBuffer(input);
      input[0] = 0;
      assert.deepEqual(parsed.toBuffer(), original);
      const changed = parsed.updateChannel('saved', parsed.find('saved')!.with({ password: 'updated' }));
      const document = readTagDocument(changed.toBuffer());
      assert.equal(document.compressed, original[0] === 0x1f);
      assert.deepEqual(document.trailingData, Buffer.from([0xaa, 0xbb]));
      assert.equal(ChatChannelManager.fromTag(document.root).find('saved')!.password, 'updated');
      const reverted = changed.updateChannel('saved', parsed.find('saved')!);
      assert.deepEqual(reverted.toBuffer(), original);
    }
    const real = fs.readFileSync('samples/chatchannels.tag');
    assert.deepEqual(ChatChannelManager.fromBuffer(real).toBuffer(), real);
    assert.equal(ChatChannelManager.fromBuffer(new ChatChannelManager(0, []).toBuffer()).channels.length, 0);
  });

  it('rejects wrong primitive/list types, incomplete records and unsupported versions explicitly', () => {
    assert.throws(() => ChatChannel.fromTag(Tags.int(null, 1)), /STRUCT/);
    assert.throws(() => ChatChannel.fromTag(Tags.struct(null, [])));
    for (const version of [-1, 3, 99]) {
      const source = channel(); source.getStruct()[0] = Tags.byte(null, version);
      assert.throws(() => ChatChannel.fromTag(source), { code: 'E_UNSUPPORTED' });
    }
    for (const version of [0, 1, 2]) {
      const known = version < 2 ? 6 : 8;
      for (let index = 0; index < known; index++) {
        const source = channel(version); source.getStruct()[index] = Tags.nothing(null);
        assert.throws(() => ChatChannel.fromTag(source), { code: 'E_FORMAT' });
      }
      for (const index of version < 2 ? [2, 3] : [2, 3, 4]) {
        const source = channel(version); source.getStruct()[index] = Tags.struct(null, [Tags.int(null, 4)]);
        assert.throws(() => ChatChannel.fromTag(source), { code: 'E_FORMAT' });
      }
    }
    assert.throws(() => ChatChannelManager.fromTag(Tags.int(null, 1)), /STRUCT/);
    for (const source of [Tags.struct(null, []), Tags.struct(null, [Tags.byte(null, 0)]),
      Tags.struct(null, [Tags.int(null, 0), Tags.struct(null, [])]),
      Tags.struct(null, [Tags.byte(null, 0), Tags.string(null, 'bad')])]) {
      assert.throws(() => ChatChannelManager.fromTag(source), { code: 'E_FORMAT' });
    }
    assert.throws(() => ChatChannelManager.fromTag(Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [])])), { code: 'E_UNSUPPORTED' });
    assert.throws(() => ChatChannelManager.fromTag(manager([channel(), Tags.int(null, 2)])));
  });

  it('rejects identity collisions and edits that historical schemas cannot represent', () => {
    const record = new ChatChannel('saved', '', true, true, [], [], []);
    assert.throws(() => new ChatChannelManager(1, []), { code: 'E_UNSUPPORTED' });
    assert.throws(() => new ChatChannelManager(0, [record, record]), { code: 'E_FORMAT' });
    assert.throws(() => new ChatChannelManager(0, [null as any]), { code: 'E_FORMAT' });
    assert.throws(() => new ChatChannelManager(0, null as any), { code: 'E_FORMAT' });
    assert.throws(() => new ChatChannel('x', '', false, true, [], [], [], 3), { code: 'E_UNSUPPORTED' });
    for (const version of [0, 1]) {
      const old = ChatChannel.fromTag(channel(version));
      assert.throws(() => old.with({ muted: ['new'] }), { code: 'E_UNSUPPORTED' });
      assert.throws(() => old.with({ isPublic: false }), { code: 'E_UNSUPPORTED' });
    }
    const archive = new ChatChannelManager(0, [record]);
    assert.throws(() => archive.addChannel(record), { code: 'E_FORMAT' });
    assert.throws(() => archive.updateChannel('absent', record), { code: 'E_RANGE' });
    assert.throws(() => archive.updateChannel('saved', null as any), { code: 'E_FORMAT' });
    const two = archive.addChannel(record.with({ uid: 'other' }));
    assert.throws(() => two.updateChannel('saved', record.with({ uid: 'other' })), { code: 'E_FORMAT' });
    for (const changes of [{ uid: 3 }, { password: null }, { isPermanent: 1 }, { isPublic: 'true' },
      { moderators: null }, { banned: [3] }, { muted: ['ok', 3] }]) {
      assert.throws(() => record.with(changes as any), { code: 'E_FORMAT' });
    }
  });

  it('honors configurable Tag limits on reads, snapshots and edits without recharging shared budgets', () => {
    const root = manager(), bytes = writeTo(root), nodes = { remainingNodes: 1000 };
    readFrom(bytes, { sharedNodeBudget: nodes }); const consumed = 1000 - nodes.remainingNodes;
    const sharedNodeBudget = { remainingNodes: consumed };
    const parsed = ChatChannelManager.fromBuffer(bytes, { sharedNodeBudget });
    assert.equal(sharedNodeBudget.remainingNodes, 0); assert.deepEqual(parsed.toBuffer(), bytes);
    const compressed = gzipSync(bytes.subarray(2)), sharedInflationBudget = { remainingBytes: bytes.length - 2 };
    const packed = ChatChannelManager.fromBuffer(compressed, { sharedInflationBudget, maxInputBytes: compressed.length });
    assert.equal(sharedInflationBudget.remainingBytes, 0); assert.deepEqual(packed.toBuffer(), compressed);
    const exact = ChatChannelManager.fromBuffer(compressed, { maxInflatedBytes: bytes.length - 2 });
    assert.deepEqual(exact.toBuffer(), compressed);
    for (const options of [{ maxInputBytes: bytes.length - 1 }, { maxInflatedBytes: bytes.length - 1 }, { maxDepth: 1 }, { maxNodes: 2 }]) {
      assert.throws(() => ChatChannelManager.fromBuffer(bytes, options), { code: 'E_LIMIT' });
    }
    assert.throws(() => ChatChannelManager.fromBuffer(bytes, { maxListLength: 1 }));
    assert.throws(() => ChatChannelManager.fromTag(root, { maxNodes: 2 }), { code: 'E_LIMIT' });
    const small = new ChatChannelManager(0, [], { maxNodes: 8 });
    assert.throws(() => small.addChannel(new ChatChannel('new', '', false, true, [], [], [])), { code: 'E_LIMIT' });
    const bounded = ChatChannelManager.fromBuffer(bytes, { maxInflatedBytes: bytes.length });
    assert.throws(() => bounded.updateChannel('saved', bounded.find('saved')!.with({ password: 'x'.repeat(bytes.length) })), /limit|budget/i);
    assert.throws(() => ChatChannelManager.fromBuffer(Buffer.concat([bytes, Buffer.from([1])]), { allowTrailingBytes: false }), { code: 'E_FORMAT' });
  });

  it('supports larger explicit nesting budgets through snapshots and later edits', () => {
    let extension = Tags.string(null, 'future');
    for (let index = 0; index < 70; index++) extension = Tags.struct(null, [extension]);
    const root = manager(); root.getStruct().splice(-1, 0, Tags.rename(extension, 'deepExtension'));
    const options = { maxDepth: 80 }, bytes = writeTo(root, options);
    assert.throws(() => ChatChannelManager.fromBuffer(bytes), { code: 'E_LIMIT' });
    const parsed = ChatChannelManager.fromBuffer(bytes, options); options.maxDepth = 1;
    assert.deepEqual(parsed.toBuffer(), bytes);
    const changed = parsed.updateChannel('saved', parsed.find('saved')!.with({ password: 'new' }));
    assert.ok(readFrom(changed.toBuffer(), { maxDepth: 80 }).findByName('deepExtension'));
  });
});
