import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { SessionUsage, UsageReport } from '@shared/types'
import { forEachJsonl } from './transcriptUtils'
import { findClaudeTranscriptFile } from './claudeSessions'

/**
 * Token accounting and rough cost estimation, read from the same on-disk
 * transcripts the rest of the app already understands. Cost is an estimate:
 * pricing is a static table and only Anthropic models are priced, so Codex and
 * Gemini contribute token counts but a null cost.
 */

/** USD per 1M tokens, by model family. Input price also anchors cache pricing. */
const PRICING: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 0.8, out: 4 }
}

function modelFamily(model: string | null): keyof typeof PRICING | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return null
}

function empty(): SessionUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    model: null,
    costUsd: null
  }
}

/** Estimate USD for a usage record. Cache reads are ~0.1x input, writes ~1.25x. */
function priceOf(u: SessionUsage): number | null {
  const fam = modelFamily(u.model)
  if (!fam) return null
  const p = PRICING[fam]
  const dollars =
    (u.inputTokens * p.in +
      u.outputTokens * p.out +
      u.cacheReadTokens * p.in * 0.1 +
      u.cacheCreateTokens * p.in * 1.25) /
    1_000_000
  return Math.round(dollars * 100) / 100
}

function add(into: SessionUsage, from: SessionUsage): void {
  into.inputTokens += from.inputTokens
  into.outputTokens += from.outputTokens
  into.cacheReadTokens += from.cacheReadTokens
  into.cacheCreateTokens += from.cacheCreateTokens
  if (!into.model && from.model) into.model = from.model
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/* ---------- Claude Code ---------- */

async function sumClaudeFile(file: string): Promise<SessionUsage> {
  const u = empty()
  await forEachJsonl(file, (d) => {
    if (d.type !== 'assistant') return
    const msg = d.message as { usage?: Record<string, unknown>; model?: unknown } | undefined
    if (!msg) return
    if (!u.model && typeof msg.model === 'string') u.model = msg.model
    const usage = msg.usage
    if (usage) {
      u.inputTokens += num(usage.input_tokens)
      u.outputTokens += num(usage.output_tokens)
      u.cacheReadTokens += num(usage.cache_read_input_tokens)
      u.cacheCreateTokens += num(usage.cache_creation_input_tokens)
    }
  })
  u.costUsd = priceOf(u)
  return u
}

/* ---------- Codex ---------- */

async function sumCodexFile(file: string): Promise<SessionUsage> {
  const u = empty()
  await forEachJsonl(file, (line) => {
    const p =
      line.payload && typeof line.payload === 'object'
        ? (line.payload as Record<string, unknown>)
        : line
    if (!u.model && typeof p.model === 'string') u.model = p.model
    // Codex emits token_count events; accept a couple of shapes defensively.
    const usage =
      (p.usage as Record<string, unknown> | undefined) ??
      (p.total_token_usage as Record<string, unknown> | undefined) ??
      (p.info && typeof p.info === 'object'
        ? ((p.info as Record<string, unknown>).total_token_usage as Record<string, unknown>)
        : undefined)
    if (usage) {
      u.inputTokens = Math.max(u.inputTokens, num(usage.input_tokens ?? usage.prompt_tokens))
      u.outputTokens = Math.max(u.outputTokens, num(usage.output_tokens ?? usage.completion_tokens))
      u.cacheReadTokens = Math.max(u.cacheReadTokens, num(usage.cached_input_tokens))
    }
  })
  u.costUsd = priceOf(u)
  return u
}

/**
 * Usage for a single session, located by its recorded cwd. Only Claude Code
 * stores a per-session file addressable from the cwd; other agents return null.
 */
export async function readSessionUsage(
  agentId: string,
  cwd: string,
  sessionId: string
): Promise<SessionUsage | null> {
  try {
    if (agentId === 'claude-code') {
      const file = await findClaudeTranscriptFile(cwd, sessionId)
      return file ? await sumClaudeFile(file) : null
    }
  } catch {
    /* fall through */
  }
  return null
}

/* ---------- Machine-wide rollup ---------- */

async function listDeep(dir: string, cap = 2000): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    const files: string[] = []
    for (const e of entries) {
      if (files.length >= cap) break
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const parent =
          (e as unknown as { parentPath?: string; path?: string }).parentPath ??
          (e as unknown as { path?: string }).path ??
          dir
        files.push(join(parent, e.name))
      }
    }
    return files
  } catch {
    return []
  }
}

/** Read the recorded cwd out of a transcript head without a full re-scan. */
async function cwdOf(file: string, kind: 'claude' | 'codex'): Promise<string | null> {
  let cwd: string | null = null
  let seen = 0
  await forEachJsonl(file, (d) => {
    if (seen > 60) return
    seen += 1
    if (kind === 'claude') {
      if (typeof d.cwd === 'string') cwd = d.cwd
    } else {
      const p =
        d.payload && typeof d.payload === 'object' ? (d.payload as Record<string, unknown>) : d
      if (typeof p.cwd === 'string') cwd = p.cwd
    }
  })
  return cwd
}

/**
 * Estimate token usage and cost for every session on the machine, grouped by
 * project folder. A full scan of all transcripts, so it is opt-in rather than
 * part of the default discovery pass.
 */
export async function readAllUsage(): Promise<UsageReport> {
  const claudeRoot = join(homedir(), '.claude', 'projects')
  let claudeFiles: string[] = []
  try {
    const dirs = await readdir(claudeRoot)
    const nested = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const full = join(claudeRoot, dir)
          const s = await stat(full)
          if (!s.isDirectory()) return []
          return (await readdir(full)).filter((f) => f.endsWith('.jsonl')).map((f) => join(full, f))
        } catch {
          return []
        }
      })
    )
    claudeFiles = nested.flat()
  } catch {
    /* no claude store */
  }
  const codexFiles = await listDeep(join(homedir(), '.codex', 'sessions'))

  const byPath: Record<string, SessionUsage> = {}
  const attribute = async (file: string, kind: 'claude' | 'codex'): Promise<void> => {
    const cwd = await cwdOf(file, kind)
    if (!cwd) return
    const u = kind === 'claude' ? await sumClaudeFile(file) : await sumCodexFile(file)
    if (!byPath[cwd]) byPath[cwd] = empty()
    add(byPath[cwd], u)
  }

  await Promise.all([
    ...claudeFiles.map((f) => attribute(f, 'claude').catch(() => {})),
    ...codexFiles.map((f) => attribute(f, 'codex').catch(() => {}))
  ])

  const total = empty()
  for (const cwd of Object.keys(byPath)) {
    byPath[cwd].costUsd = priceOf(byPath[cwd])
    add(total, byPath[cwd])
  }
  total.costUsd = priceOf(total)

  return { total, byPath }
}
