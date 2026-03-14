import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, stableMediaId } from './media-utils.js';

test('stableMediaId returns deterministic 12-char hash', () => {
  const a = stableMediaId('movies/inception.mp4');
  const b = stableMediaId('movies/inception.mp4');
  const c = stableMediaId('movies/interstellar.mp4');

  assert.equal(a, b);
  assert.equal(a.length, 12);
  assert.notEqual(a, c);
});

test('parseRange parses closed ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=100-200', 1000), { start: 100, end: 200 });
});

test('parseRange parses open-ended ranges', () => {
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
});

test('parseRange parses suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

test('parseRange rejects invalid ranges', () => {
  assert.equal(parseRange('', 1000), null);
  assert.equal(parseRange('bytes=-0', 1000), null);
  assert.equal(parseRange('bytes=1000-1001', 1000), null);
  assert.equal(parseRange('bytes=100-99', 1000), null);
  assert.equal(parseRange('items=1-2', 1000), null);
});
