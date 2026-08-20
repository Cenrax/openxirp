import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findClaudeTranscriptFile } from './claudeSessions'
import { findCodexTranscriptFile } from './codexSessions'

const SESSION_ID = '12345678-1234-1234-1234-123456789abc'

test('Codex lookup skips a matching session ID recorded for another project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openxirp-codex-'))
  try {
    const wrong = join(root, 'wrong', `rollout-${SESSION_ID}.jsonl`)
    const right = join(root, 'right', `rollout-${SESSION_ID}.jsonl`)
    await mkdir(join(root, 'wrong'), { recursive: true })
    await mkdir(join(root, 'right'), { recursive: true })
    await writeFile(
      wrong,
      JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: '/project-b' } })
    )
    await writeFile(
      right,
      JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: '/project-a' } })
    )

    assert.equal(
      await findCodexTranscriptFile('/project-a', SESSION_ID, [wrong, right]),
      right
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Claude fallback skips a matching session ID recorded for another project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openxirp-claude-'))
  try {
    const wrongDir = join(root, 'a-wrong-project')
    const rightDir = join(root, 'z-right-project')
    await mkdir(wrongDir, { recursive: true })
    await mkdir(rightDir, { recursive: true })
    await writeFile(join(wrongDir, `${SESSION_ID}.jsonl`), JSON.stringify({ cwd: '/project-b' }))
    const right = join(rightDir, `${SESSION_ID}.jsonl`)
    await writeFile(right, JSON.stringify({ cwd: '/project-a/subdirectory' }))

    assert.equal(await findClaudeTranscriptFile('/project-a', SESSION_ID, root), right)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('transcript lookup rejects candidates outside the requested project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openxirp-transcript-'))
  try {
    const codex = join(root, `rollout-${SESSION_ID}.jsonl`)
    await writeFile(
      codex,
      JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: '/project-b' } })
    )
    const claudeDir = join(root, 'wrong-project')
    await mkdir(claudeDir)
    await writeFile(join(claudeDir, `${SESSION_ID}.jsonl`), JSON.stringify({ cwd: '/project-b' }))

    assert.equal(await findCodexTranscriptFile('/project-a', SESSION_ID, [codex]), null)
    assert.equal(await findClaudeTranscriptFile('/project-a', SESSION_ID, root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
