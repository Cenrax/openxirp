import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyTail } from './PtyManager'

test('recent output classifies a live session as working', () => {
  assert.equal(classifyTail('ordinary output', 1000, Infinity, true), 'working')
})

test('working hints bridge short gaps between output chunks', () => {
  assert.equal(classifyTail('Thinking…', 5000, Infinity, true), 'working')
})

test('stale working hints expire to idle', () => {
  assert.equal(classifyTail('Thinking…', 30_000, Infinity, true), 'idle')
  assert.equal(classifyTail('⠋', 30_000, Infinity, true), 'idle')
})

test('blocked prompts win after a stale working hint expires', () => {
  const backlog = ['Thinking…', 'Do you want to continue?'].join('\n')
  assert.equal(classifyTail(backlog, 30_000, Infinity, true), 'blocked')
})

test('dead sessions remain exited regardless of their tail', () => {
  assert.equal(classifyTail('Thinking…', 0, 0, false), 'exited')
})
