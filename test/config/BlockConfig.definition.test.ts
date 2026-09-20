/** Named block construction, complete edits and extension-preserving XML exports. */
import { assert } from 'chai';
import { XMLParser } from 'fast-xml-parser';
import { BlockConfig, BlockDefinition } from '../../src/config/BlockConfig.js';

describe('Block definition models', () => {
  it('creates a block without positional arguments and exports its type mapping', () => {
    const block = BlockDefinition.create({ id: 2000, name: 'Custom hull' });
    assert.equal(block.id, 2000); assert.equal(block.name, 'Custom hull');
    assert.equal(block.xmlTypeName, 'CUSTOM_BLOCK_2000');
    assert.equal(block.hp, 100); assert.deepEqual(block.textureIds, [0, 0, 0, 0, 0, 0]);
    const config = BlockConfig.fromBlocks([block]);
    const mapping = BlockConfig._parseBlockTypes(config.toBlockTypesProperties());
    assert.equal(mapping.get(block.xmlTypeName), 2000);
    assert.deepEqual(BlockConfig.fromXml(config.toXml(), mapping).getById(2000), block);
  });

  it('edits identity, icon, variant arrays and computer references without changing other fields', () => {
    const original = BlockDefinition.create({ id: 2000, name: 'Source', hp: 73, metadata: { fullName: 'Extended', effectArmor: { heat: 2 } } });
    const clone = original.with({ id: 2001, name: 'Clone', xmlTypeName: 'CUSTOM_CLONE', icon: 12,
      textureIds: [1, 2, 3, 4, 5, 6], slabIds: [7, 8], styleIds: [9], computerReference: 10,
      metadata: { effectArmor: { kinetic: 3 } } });
    assert.equal(clone.hp, 73); assert.equal(clone.id, 2001); assert.equal(clone.icon, 12);
    assert.deepEqual(clone.slabIds, [7, 8]); assert.deepEqual(clone.styleIds, [9]); assert.equal(clone.computerReference, 10);
    assert.deepEqual(clone.metadata.effectArmor, { heat: 2, kinetic: 3, em: 0 });
    assert.equal(clone.metadata.fullName, 'Extended'); assert.equal(original.id, 2000);
    const config = BlockConfig.fromBlocks([original, clone]);
    const parsed = BlockConfig.fromXml(config.toXml(), BlockConfig._parseBlockTypes(config.toBlockTypesProperties()));
    assert.deepEqual(parsed.all, config.all);
  });

  it('preserves unknown XML properties, attributes and lexical extension values through edits', () => {
    const xml = '<Config><Block type="2000" name="Original" icon="0" textureId="1" future="001">' +
      '<Hitpoints unit="points">100</Hitpoints><Vendor flag="yes"><Code>001</Code><Code>002</Code><Label>  spaced  </Label></Vendor>' +
      '<EffectArmor version="future"><Heat unit="ratio">2</Heat><Kinetic>3</Kinetic><EM>4</EM><Other>005</Other></EffectArmor>' +
      '</Block></Config>';
    const block = BlockConfig.fromXml(xml).getById(2000)!;
    assert.equal(block.hp, 100); assert.equal(block.metadata.effectArmor.heat, 2);
    assert.equal(block.extraProperties['@_future'], '001');
    assert.deepEqual((block.extraProperties.Vendor as any).Code, ['001', '002']);
    const edited = block.with({ name: 'Changed', hp: 150, metadata: { effectArmor: { heat: 6 } } });
    const text = BlockConfig.fromBlocks([edited]).toXml();
    const node = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(text).Config.Element.General.Custom.Block;
    assert.equal(node['@_future'], '001'); assert.equal(node.Hitpoints['@_unit'], 'points'); assert.equal(node.Hitpoints['#text'], '150');
    assert.deepEqual(node.Vendor.Code, ['001', '002']); assert.equal(node.Vendor.Label, '  spaced  ');
    assert.equal(node.EffectArmor['@_version'], 'future'); assert.equal(node.EffectArmor.Other, '005');
    assert.equal(node.EffectArmor.Heat['@_unit'], 'ratio'); assert.equal(node.EffectArmor.Heat['#text'], '6');
    assert.equal(BlockConfig.fromXml(text).getById(2000)!.hp, 150);
  });

  it('takes deep defensive snapshots of creation and update inputs', () => {
    const textureIds = [1, 2, 3], slabIds = [4], color: [number, number, number, number] = [0.1, 0.2, 0.3, 1];
    const metadata = { consistence: [{ type: 'SOURCE', count: 2 }], effectArmor: { heat: 3 }, collisionDefault: { type: 'BOX', slab: 1, styleId: 2 } };
    const extras = { '@_future': 'value', Vendor: { Item: [{ '#text': '001', '@_count': '02' }] } };
    const original = BlockDefinition.create({ id: 1, name: 'One', textureIds, slabIds, lightSourceColor: color, metadata, extraProperties: extras });
    textureIds[0] = 99; slabIds.push(9); color[0] = 9; metadata.consistence[0].count = 99;
    metadata.effectArmor.heat = 99; metadata.collisionDefault.styleId = 99; extras.Vendor.Item[0]['#text'] = 'changed';
    assert.deepEqual(original.textureIds, [1, 2, 3]); assert.deepEqual(original.slabIds, [4]); assert.equal(original.lightSourceColor[0], 0.1);
    assert.equal(original.metadata.consistence[0].count, 2); assert.equal(original.metadata.effectArmor.heat, 3);
    assert.equal(original.metadata.collisionDefault!.styleId, 2); assert.equal((original.extraProperties.Vendor as any).Item[0]['#text'], '001');
    const styles = [5, 6], update = { effectArmor: { em: 4 }, chamberChildren: [7] };
    const edited = original.with({ styleIds: styles, metadata: update }); styles.push(7); update.effectArmor.em = 99; update.chamberChildren[0] = 99;
    assert.deepEqual(edited.styleIds, [5, 6]); assert.equal(edited.metadata.effectArmor.em, 4); assert.deepEqual(edited.metadata.chamberChildren, [7]);
    assert.notStrictEqual(original.metadata, edited.metadata); assert.isTrue(Object.isFrozen(edited.metadata.effectArmor));
    assert.isTrue(Object.isFrozen(edited));
    assert.isTrue(Object.isFrozen(edited.extraProperties)); assert.isTrue(Object.isFrozen(edited.textureIds));
    const blocks = [original], config = BlockConfig.fromBlocks(blocks); blocks[0] = edited;
    assert.deepEqual(config.getById(1), original);
  });

  it('preserves explicit derived flags when unrelated fields change and updates chambers on request', () => {
    const block = BlockDefinition.create({ id: 1, name: 'One', chamberRoot: 2, reactorChamberSpecific: false });
    assert.isFalse(block.with({ hp: 9 }).reactorChamberSpecific);
    assert.isTrue(block.with({ chamberRoot: 3 }).reactorChamberSpecific);
    assert.isFalse(block.with({ chamberRoot: 0 }).reactorChamberSpecific);
    assert.deepEqual(block.with({}), block);
  });

  it('rejects invalid creation identities and ambiguous collection mappings', () => {
    for (const id of [0, -1, 1.5, NaN, 4095]) assert.throws(() => BlockDefinition.create({ id, name: 'bad' }), /id/);
    for (const name of ['', ' ', undefined]) assert.throws(() => BlockDefinition.create({ id: 1, name } as any), /name/);
    const block = BlockDefinition.create({ id: 1, name: 'One', xmlTypeName: 'TYPE' });
    assert.throws(() => BlockConfig.fromBlocks([block, block]), /Duplicate/);
    assert.throws(() => BlockConfig.fromBlocks([block, block.with({ id: 2, xmlTypeName: ' type ' })]), /Duplicate/);
    for (const invalid of [block.with({ id: NaN }), block.with({ id: 0 }), block.with({ id: 4095 }), block.with({ xmlTypeName: ' ' }), block.with({ xmlTypeName: '2' })]) {
      assert.throws(() => BlockConfig.fromBlocks([invalid]), /valid|conflicts/);
    }
    const ambiguous = BlockConfig.fromXml('<Config><Block type="1" name="One"/><Block type="2" name="Two"/></Config>')
      .set(block.with({ id: 2, xmlTypeName: '1' }));
    assert.throws(() => ambiguous.toXml(), /conflicts/); assert.throws(() => ambiguous.toBlockTypesProperties(), /conflicts/);
  });

  it('exports deterministic Java property keys including escaped Unicode and delimiters', () => {
    const blocks = [BlockDefinition.create({ id: 2, name: 'Two', xmlTypeName: '123_CUSTOM' }),
      BlockDefinition.create({ id: 1, name: 'One', xmlTypeName: 'A B:=\\é🚀' })];
    const config = BlockConfig.fromBlocks(blocks), properties = config.toBlockTypesProperties();
    assert.isTrue(properties.startsWith('A\\u0020B\\u003a\\u003d\\u005c\\u00e9\\ud83d\\ude80=1\n'));
    const mapping = BlockConfig._parseBlockTypes(properties);
    assert.deepEqual(mapping, new Map([['A B:=\\é🚀', 1], ['123_CUSTOM', 2]]));
    assert.deepEqual(BlockConfig.fromXml(config.toXml(), mapping).all, config.all);
    assert.equal(BlockConfig.fromBlocks([]).toBlockTypesProperties(), '');
  });

  it('retains untouched known subtrees and permits explicit extension replacement', () => {
    const xml = '<Config><Block type="1" name="One" icon="0" textureId="1"><Hitpoints unit="hp">100</Hitpoints>' +
      '<ControlledBy future="yes"><Element code="A">TYPE_A</Element></ControlledBy><Vendor>old</Vendor></Block></Config>';
    const original = BlockConfig.fromXml(xml).getById(1)!;
    assert.deepEqual(original.metadata.controlledBy, ['TYPE_A']);
    const unchanged = BlockConfig.fromBlocks([original.with({ name: 'renamed' })]).toXml();
    assert.include(unchanged, '<Hitpoints unit="hp">100</Hitpoints>');
    assert.include(unchanged, '<Element code="A">TYPE_A</Element>');
    const updated = original.with({ extraProperties: { Vendor: 'new', Additional: { Item: ['one', 'two'] } },
      metadata: { controlledBy: ['TYPE_B', 'TYPE_C'], consistence: [{ type: 'TYPE_B', count: 2 }, { type: 'TYPE_C', count: 3 }] } });
    const output = BlockConfig.fromBlocks([updated]).toXml();
    assert.include(output, '<Vendor>new</Vendor>'); assert.include(output, '<ControlledBy future="yes">');
    assert.include(output, '<Element code="A">TYPE_B</Element>');
    assert.deepEqual(BlockConfig.fromXml(output).getById(1)!.metadata.controlledBy, ['TYPE_B', 'TYPE_C']);
    const cleared = original.with({ metadata: { controlledBy: [] } });
    assert.notInclude(BlockConfig.fromBlocks([cleared]).toXml(), '<ControlledBy');
    const arrays = BlockConfig.fromXml('<Config><Block type="1" name="One"><Consistence><Item count="1">TYPE_A</Item><Item count="2">TYPE_B</Item></Consistence></Block></Config>').getById(1)!;
    const arrayEdit = arrays.with({ metadata: { consistence: [{ type: 'TYPE_C', count: 3 }, { type: 'TYPE_D', count: 4 }] } });
    assert.deepEqual(BlockConfig.fromXml(BlockConfig.fromBlocks([arrayEdit]).toXml()).getById(1)!.metadata.consistence, arrayEdit.metadata.consistence);
  });

  it('keeps extension elements with type/name attributes inside their owning block', () => {
    const config = BlockConfig.fromXml('<Config><Block type="1" name="One"><Vendor type="2" name="Unrelated"><Data>003</Data></Vendor></Block></Config>');
    assert.equal(config.size, 1);
    assert.deepEqual(config.getById(1)!.extraProperties.Vendor, { Data: '003', '@_type': '2', '@_name': 'Unrelated' });
    assert.equal(BlockConfig.fromXml(config.toXml()).size, 1);
  });

  it('resolves a newly constructed chamber upgrade chain to its original root', () => {
    const base = BlockDefinition.create({ id: 1, name: 'Base chamber', metadata: { generalChamber: true, chamberUpgradesTo: 2 } });
    const upgrade = BlockDefinition.create({ id: 2, name: 'Upgraded chamber', chamberRoot: 1, metadata: { chamberParent: 1 } });
    const config = BlockConfig.fromBlocks([base, upgrade]);
    assert.equal(config.getElementInfoById(2)!.chamber.upgradedRoot!.id, 1);
    assert.equal(base.toElementInfo().chamber.upgradedRoot!.id, 1);
  });
});
