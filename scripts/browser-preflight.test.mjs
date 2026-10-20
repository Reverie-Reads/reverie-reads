import assert from 'node:assert/strict'
import test from 'node:test'
import { browserCapacity } from './browser-preflight.mjs'

test('normal capacity is admitted while measured saturation and a recent backlog are refused', () => {
  assert.equal(browserCapacity(8, [4, 6, 8]).admitted, true)
  assert.equal(browserCapacity(8, [318.15, 241.34, 162.34]).admitted, false)
  assert.equal(browserCapacity(8, [5, 29, 63]).admitted, false)
  assert.equal(browserCapacity(2, [5, 2, 1]).admitted, false)
})
test('missing, invalid or negative capacity cannot certify a local run', () => {
  for (const [cpus, loads] of [
    [0, [0, 0, 0]],
    [8, [NaN, 0]],
    [8, [-1, 0]],
    [8, [1]],
    [1.5, [0, 0]],
  ]) {
    assert.equal(browserCapacity(cpus, loads).admitted, false)
  }
})
