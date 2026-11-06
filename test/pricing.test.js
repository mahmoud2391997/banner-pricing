'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { quote } = require('../public/assets/pricing-core.js');
const config = require('../config/pricing.json');

test('4 × 6 ft 13 oz vinyl banner = 24 sq ft × $3.50 + $15 setup = $99.00', () => {
  const q = quote(config, { widthFt: '4', heightFt: '6', materialId: 'vinyl-13oz' });
  assert.ok(q.ok);
  assert.strictEqual(q.sqft, 24);
  assert.strictEqual(q.materialCents, 8400);
  assert.strictEqual(q.setupCents, 1500);
  assert.strictEqual(q.totalCents, 9900);
});

test('switching material changes only the rate', () => {
  const q = quote(config, { widthFt: 4, heightFt: 6, materialId: 'sticker-matte' });
  assert.strictEqual(q.totalCents, 24 * 650 + 1500);
});

test('fractional feet round to the cent', () => {
  const q = quote(config, { widthFt: 2.5, heightFt: 3.25, materialId: 'vinyl-15oz' });
  // 8.125 sq ft × 4.25 = 34.53125 → $34.53
  assert.strictEqual(q.materialCents, 3453);
});

test('rejects missing, zero, oversize and unknown material', () => {
  assert.ok(!quote(config, { widthFt: '', heightFt: 6, materialId: 'vinyl-13oz' }).ok);
  assert.ok(!quote(config, { widthFt: 0, heightFt: 6, materialId: 'vinyl-13oz' }).ok);
  assert.ok(!quote(config, { widthFt: 40, heightFt: 6, materialId: 'vinyl-13oz' }).ok);
  assert.ok(!quote(config, { widthFt: 4, heightFt: 6, materialId: 'gold-leaf' }).ok);
});

test('hidden materials cannot be ordered', () => {
  const c = JSON.parse(JSON.stringify(config));
  c.materials[0].active = false;
  assert.ok(!quote(c, { widthFt: 4, heightFt: 6, materialId: 'vinyl-13oz' }).ok);
});
