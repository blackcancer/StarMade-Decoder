import { assert } from 'chai';
import { TradePricesObject } from '../../src/db/TradePricesObject.js';
import { encodeTradeNodeItems } from '../../src/db/TradeNodeItems.js';

describe('TradePricesObject integrity', () => {
  it('detaches entry views and stringifies bigint identifiers exactly', () => {
    const model = TradePricesObject.empty(9007199254740993n).withBuyOrder(3, -5, -10);
    const before = model.toBytes();
    model.entries[0].price = 999;
    model.buyOrders[0].amount = 998;
    model.getBuyOrder(3)!.limit = 997;
    assert.deepEqual(model.toBytes(), before);
    assert.equal(JSON.parse(JSON.stringify(model)).entDbId, '9007199254740993');
  });
  it('validates identity, sign and wire widths immediately', () => {
    assert.throws(() => TradePricesObject.empty(1n << 63n));
    const model = TradePricesObject.empty(-1n);
    assert.throws(() => model.withBuyOrder(0, 1, 1));
    assert.throws(() => model.withBuyOrder(-3, 1, 1));
    assert.throws(() => model.withSellOrder(-3, 1, 1));
    assert.throws(() => model.withSellOrder(3, 2 ** 31, 1));
    assert.throws(() => model.withBuyOrder(3, 1, 1, 0.1));
    assert.equal(model.size, 0);
  });
  it('retains unusual decoded prices and duplicate rows when changing only the entity', () => {
    const rows = [
      { type: 0, blockType: 0, isBuyOrder: false, amount: -2147483648, price: 2147483647, limit: -2147483648 },
      { type: -32768, blockType: 32768, isBuyOrder: true, amount: 0, price: -1, limit: 0 },
      { type: -32768, blockType: 32768, isBuyOrder: true, amount: 1, price: -2, limit: 3 },
    ];
    const model = TradePricesObject.fromBytes(encodeTradeNodeItems({ entDbId: -(1n << 63n), entries: rows }))!;
    assert.deepEqual(model.entries, rows);
    const changed = model.withEntDbId((1n << 63n) - 1n);
    assert.deepEqual(TradePricesObject.fromBytes(changed.toBytes())!.entries, rows);
    assert.equal(JSON.parse(JSON.stringify(changed)).entDbId, '9223372036854775807');
    const json = model.toJSON(); json.entries[0].price = 7;
    model.sellOrders[0].price = 8;
    model.getSellOrder(0)!.price = 9;
    assert.equal(model.getSellOrder(0)!.price, 2147483647);
    assert.throws(() => { (model as any).entDbId = 0n; }, TypeError);
  });

  it('checks signed boundaries for both order kinds without imposing price policies', () => {
    const original = TradePricesObject.empty(0n);
    const valid = original.withBuyOrder(32768, -2147483648, 2147483647, -2147483648)
      .withSellOrder(32767, 2147483647, -2147483648, 2147483647);
    assert.deepEqual(TradePricesObject.fromBytes(valid.toBytes())!.entries, valid.entries);
    for (const id of [-1, 0, 0.5, NaN, Infinity, 32769]) assert.throws(() => original.withBuyOrder(id, 0, 0));
    for (const id of [-1, 0, 0.5, NaN, Infinity, 32768]) assert.throws(() => original.withSellOrder(id, 0, 0));
    for (const value of [-2147483649, 2147483648, 0.5, NaN]) {
      assert.throws(() => original.withBuyOrder(1, value, 0));
      assert.throws(() => original.withBuyOrder(1, 0, value));
      assert.throws(() => original.withSellOrder(1, 0, 0, value));
    }
    assert.throws(() => original.withEntDbId(-(1n << 63n) - 1n));
    assert.throws(() => original.withEntDbId(0 as any));
    assert.equal(original.size, 0);
  });
});
