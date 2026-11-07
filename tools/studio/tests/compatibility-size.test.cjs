'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compatibilityPlan, compatibilityLimit, assertCompatibilitySize } = require('../lib/compatibility-size.cjs');

test('compatibility uses the original budget rather than the destination bitrate ceiling', () => {
  const source = { bytes: 1569501562, duration: 8925.743, hasAudio: true, audioBitrate: 384000, reasons: ['AAC audio', 'stereo audio'] };
  const plan = compatibilityPlan(source, 6500000);
  assert.ok(plan.videoBitrate < 1200000);
  assert.equal(plan.audioBitrate, 192000);
  assert.ok(plan.targetBytes <= source.bytes);
  assert.throws(() => assertCompatibilitySize(source.bytes, 7453993314), { code: 'COMPATIBILITY_SIZE' });
  assert.doesNotThrow(() => assertCompatibilitySize(source.bytes, source.bytes * 1.02));
  assert.throws(() => assertCompatibilitySize(source.bytes, source.bytes * 1.04), { code: 'COMPATIBILITY_SIZE' });
  assert.equal(compatibilityLimit(10e9), 10e9 + 100 * 1024 ** 2);
});

test('copied AAC keeps its existing rate and silent video spends no budget on audio', () => {
  const source = { bytes: 100e6, duration: 600, reasons: [], audioBitrate: 96000 };
  assert.equal(compatibilityPlan(source, 6500000).audioBitrate, 96000);
  assert.equal(compatibilityPlan({ ...source, hasAudio: false }, 6500000).audioBitrate, 0);
  assert.throws(() => compatibilityLimit(0));
  assert.throws(() => compatibilityPlan({ ...source, duration: 0 }, 6500000));
});
