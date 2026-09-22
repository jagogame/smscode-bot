'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers');

test('uid() returns non-empty, unique ids', () => {
  const c = loadCore();
  const a = c.uid();
  const b = c.uid();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test('esc() escapes HTML special characters', () => {
  const c = loadCore();
  assert.equal(c.esc(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(c.esc(null), '');
  assert.equal(c.esc(undefined), '');
});

test('num() coerces invalid/non-finite input to 0', () => {
  const c = loadCore();
  assert.equal(c.num('42'), 42);
  assert.equal(c.num('abc'), 0);
  assert.equal(c.num(undefined), 0);
  assert.equal(c.num(Infinity), 0);
});

test('rp() formats Rupiah with id-ID thousand separators', () => {
  const c = loadCore();
  assert.equal(c.rp(1500000), 'Rp 1.500.000');
  assert.equal(c.rp('abc'), 'Rp 0');
});

test('addDays() rolls over month/year boundaries correctly', () => {
  const c = loadCore();
  assert.equal(c.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(c.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(c.addDays('2026-12-31', 1), '2027-01-01');
});

test('daysBetween() computes whole-day difference between two dates', () => {
  const c = loadCore();
  assert.equal(c.daysBetween('2026-01-01', '2026-01-10'), 9);
  assert.equal(c.daysBetween('2026-01-10', '2026-01-01'), -9);
});

test('clone() deep-clones so mutating the copy leaves the original untouched', () => {
  const c = loadCore();
  const obj = { a: { b: 1 } };
  const copy = c.clone(obj);
  copy.a.b = 99;
  assert.equal(obj.a.b, 1);
});

test('sum() totals a numeric field via accessor, ignoring non-numeric rows', () => {
  const c = loadCore();
  const rows = [{ qty: 2 }, { qty: 3 }, { qty: 'x' }];
  assert.equal(c.sum(rows, r => r.qty), 5);
});

test('pad() zero-pads to the requested width', () => {
  const c = loadCore();
  assert.equal(c.pad(7), '07');
  assert.equal(c.pad(7, 3), '007');
  assert.equal(c.pad(42), '42');
});

test('NOAUDIT excludes high-volume/noisy collections from the audit trail', () => {
  const c = loadCore();
  assert.ok(c.NOAUDIT.has('audit'));
  assert.ok(c.NOAUDIT.has('stock_moves'));
  assert.ok(!c.NOAUDIT.has('sales_orders'));
});
