import { assert } from 'chai';
import { XmlConfigDocument } from '../../src/config/XmlConfigDocument.js';

describe('XML configuration document integrity', () => {
  it('keeps exact source and unknown names, attributes, CDATA and comments through unrelated edits', () => {
    const xml = '<?xml version="1.0"?>\n<Root custom="001" __proto__="attribute"><Count>01</Count><!-- note --><Text a="b"><![CDATA[ x&y ]]></Text><N.V>literal</N.V><__proto__>safe</__proto__><constructor>safe2</constructor></Root>';
    const model = XmlConfigDocument.fromXml(xml);
    assert.equal(model.toXml(), xml);
    assert.equal(model.get('Root.Count'), 1);
    assert.equal(model.get('Root.Text.#text'), 'x&y');
    assert.equal(model.get('Root.N\\.V'), 'literal');
    assert.equal(model.get('Root.__proto__'), 'safe');
    const changed = model.set('Root.Count', 2);
    assert.equal(changed.get('Root.Count'), 2);
    assert.include(changed.toXml(), 'custom="001"');
    assert.include(changed.toXml(), '<![CDATA[ x&y ]]>');
    assert.include(changed.toXml(), '<N.V>literal</N.V>');
    assert.include(changed.toXml(), '<__proto__>safe</__proto__>');
    assert.include(changed.toXml(), '<!-- note -->');
    assert.equal(model.toXml(), xml);
    assert.equal(model.set('Root.Count', 1).toXml(), xml);
    assert.equal(model.set('Root.Text.#text', 'new&value').get('Root.Text'), 'new&value');
    assert.isUndefined((Object.prototype as any).polluted);
    assert.throws(() => model.set('Root.constructor.prototype.polluted', 'safe'), /scalar/);
    assert.equal(model.set('Root.prototype.polluted', 'safe').get('Root.prototype.polluted'), 'safe');
    assert.isUndefined((Object.prototype as any).polluted);
    assert.include(changed.toXml(), '__proto__="attribute"');
  });

  it('detaches entries and rejects ambiguous or destructive paths without dropping repeated values', () => {
    const simple = XmlConfigDocument.fromXml('<R><A>1</A></R>');
    (simple.entries() as Map<string, unknown>).set('R.A', 99);
    assert.equal(simple.get('R.A'), 1);
    const repeated = XmlConfigDocument.fromXml('<R><A>1</A><A>2</A><B>3</B></R>');
    assert.throws(() => repeated.get('R.A'), /Ambiguous/);
    assert.throws(() => repeated.set('R.A', 4), /Ambiguous/);
    assert.equal(repeated.entries().get('R.A[0]'), 1);
    assert.equal(repeated.entries().get('R.A[1]'), 2);
    assert.equal(repeated.set('R.A[1]', 7).get('R.A[1]'), 7);
    assert.equal(repeated.get('R.A[0]'), 1);
    assert.isUndefined(repeated.get('R.A[5]'));
    assert.throws(() => repeated.set('R.A[5]', 7), /index/);
    assert.throws(() => repeated.set('R.A[9007199254740992]', 7), /index/);
    assert.include(repeated.set('R.B', 4).toXml(), '<A>1</A><A>2</A>');
    assert.throws(() => simple.get('R'), /container/);
    assert.throws(() => simple.set('R', 'lost'), /container/);
    assert.throws(() => simple.set('R.A.Child', 1), /scalar/);
    assert.throws(() => simple.set('Other.A', 1), /second XML root/);
    for (const key of ['', '.R', 'R..A', 'R.bad name', 'R.<x>', 'R.1bad', null]) assert.throws(() => simple.set(key as any, 1));
    for (const value of [null, [], {}, NaN, Infinity, 1n, '\0', '\ud800']) assert.throws(() => simple.set('R.A', value as any));
    assert.equal(XmlConfigDocument.fromXml('').set('R.New.Path', 'x').get('R.New.Path'), 'x');
    assert.equal(XmlConfigDocument.fromXml('').entries().size, 0);
  });

  it('preserves lexical unknown strings and reports finite primitive values accurately', () => {
    const model = XmlConfigDocument.fromXml('<R><True>true</True><False>false</False><Large>9007199254740993</Large><Inf>1e999</Inf><Decimal>.5e1</Decimal><Float>.25<!-- preserved --></Float><Empty/></R>');
    assert.strictEqual(model.get('R.True'), true); assert.strictEqual(model.get('R.False'), false);
    assert.equal(model.get('R.Large'), '9007199254740993'); assert.equal(model.get('R.Inf'), '1e999');
    assert.strictEqual(model.get('R.Decimal'), 5); assert.strictEqual(model.get('R.Float'), 0.25);
    assert.equal(model.get('R.Empty'), ''); assert.isUndefined(model.get('absent'));
    assert.equal(model.entries().size, 7);
  });

  it('validates XML structure, character set, DTD policy and configurable resource ceilings', () => {
    for (const xml of ['<R>', '<R/><S/>', '<R>\0</R>', '<!DOCTYPE R><R/>', 1]) assert.throws(() => XmlConfigDocument.fromXml(xml as any));
    const commentary = '<R><!-- literal <!DOCTYPE example --><A><![CDATA[<!DOCTYPE example]]></A></R>';
    assert.equal(XmlConfigDocument.fromXml(commentary).toXml(), commentary);
    assert.throws(() => XmlConfigDocument.fromXml('<R/>', { maxBytes: 0 }), /budget/);
    assert.throws(() => XmlConfigDocument.fromXml('<R/>', { maxEntries: 0 }), /budget/);
    const empty = XmlConfigDocument.fromXml('', { maxBytes: 0, maxEntries: 0 });
    assert.equal(empty.toXml(), '');
    assert.throws(() => empty.set('R', 'x'), /budget/);
    assert.equal(XmlConfigDocument.fromXml('<R/>', { maxBytes: 4 }).toXml(), '<R/>');
    const bounded = XmlConfigDocument.fromXml('<R/>', { maxBytes: 16, maxEntries: 2 });
    assert.throws(() => bounded.set('R', 'x'.repeat(50)), /budget/);
    assert.throws(() => bounded.set('R.A', 'x'), /budget/);
  });

  it('merges overlays and exports only changed subtrees with attributes and repeated groups intact', () => {
    const base = XmlConfigDocument.fromXml('<?xml version="1.0"?><R a="keep"><X k="1">1</X><Y>2</Y><Repeat>old1</Repeat><Repeat>old2</Repeat></R>');
    const custom = XmlConfigDocument.fromXml('<R b="new"><X>3</X><Z>true</Z><Repeat>new1</Repeat><Repeat>new2</Repeat></R>');
    const merged = base.merge(custom);
    assert.equal(merged.get('R.X'), 3); assert.equal(merged.get('R.Y'), 2); assert.isTrue(merged.get('R.Z'));
    assert.include(merged.toXml(), 'a="keep"'); assert.include(merged.toXml(), 'b="new"');
    assert.include(merged.toXml(), '<X k="1">3</X>');
    assert.include(merged.toXml(), '<Repeat>new1</Repeat><Repeat>new2</Repeat>');
    const diff = merged.difference(base);
    assert.notInclude(diff, '<Y>'); assert.include(diff, '<X k="1">3</X>');
    assert.include(diff, '<Repeat>new1</Repeat><Repeat>new2</Repeat>');
    assert.equal(base.difference(base), '');
    assert.throws(() => base.merge(XmlConfigDocument.fromXml('<Other/>')), /root/);
    assert.equal(XmlConfigDocument.fromXml('').merge(XmlConfigDocument.fromXml('<R/>')).toXml(), '<R></R>');
    assert.equal(base.merge(XmlConfigDocument.fromXml('')).toXml(), base.toXml());
    const unique = XmlConfigDocument.fromXml('<R><A>1</A><B>2</B></R>');
    assert.equal(unique.set('R.A', 3).set('R.A', 1).toXml(), unique.toXml());
  });
});
