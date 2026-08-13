import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { AgentSessionRef, MachinePulse, MachineProjectGroup } from '@shared/types'
import { forEachJsonlHead, isHumanPrompt } from './transcriptUtils'
import { detectRunningAgents } from './liveAgents'

/** A transcript touched within this window means the agent is actively working. */
const WORKING_FRESH_MS = 12_000

function encodeClaudeDir(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Machine-wide session discovery: every coding-agent session found anywhere on
 * disk, plus every agent process running right now, grouped by the project
 * folder they belong to, whether or not that folder is added to openxirp.
 *
 * The on-disk scan reads only the head of each transcript (enough for the cwd
 * and first prompt); full transcripts load on demand when a session is opened.
 */

/** Lines to read from each transcript head before giving up on cwd/title. */
const HEAD_LINES = 80

function firstText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        return (block as { text?: string }).text ?? null
      }
    }
  }
  return null
}

interface Head {
  cwd: string | null
  title: string | null
  branch: string | null
  prompts: number
}

/* ---------- Claude Code: ~/.claude/projects/<enc>/<uuid>.jsonl ---------- */

async function scanClaude(): Promise<AgentSessionRef[]> {
  const root = join(homedir(), '.claude', 'projects')
  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return []
  }

  const perDir = await Promise.all(
    dirs.map(async (dir): Promise<AgentSessionRef[]> => {
      const full = join(root, dir)
      let files: string[]
      try {
        files = (await readdir(full)).filter((f) => f.endsWith('.jsonl'))
      } catch {
        return []
      }
      const refs = await Promise.all(
        files.map(async (file): Promise<AgentSessionRef | null> => {
          const path = join(full, file)
          const head: Head = { cwd: null, title: null, branch: null, prompts: 0 }
          try {
            const info = await stat(path)
            await forEachJsonlHead(path, HEAD_LINES, (d) => {
              if (typeof d.cwd === 'string') head.cwd = d.cwd
              if (typeof d.gitBranch === 'string' && d.gitBranch) head.branch = d.gitBranch
              if (d.type === 'summary' && typeof d.summary === 'string' && !head.title)
                head.title = d.summary
              if (d.type === 'user') {
                const msg = d.message as { content?: unknown } | undefined
                const text = firstText(msg?.content)
                if (isHumanPrompt(text)) {
                  head.prompts += 1
                  if (!head.title) head.title = text.trim()
                }
              }
            })
            if (!head.cwd) return null
            return {
              agentId: 'claude-code',
              sessionId: file.replace(/\.jsonl$/, ''),
              title: head.title?.replace(/\s+/g, ' ').slice(0, 140) || 'Untitled session',
              branch: head.branch,
              cwd: head.cwd,
              lastActive: info.mtimeMs,
              prompts: head.prompts,
              sizeBytes: info.size,
              resumable: true
            }
          } catch {
            return null
          }
        })
      )
      return refs.filter((r): r is AgentSessionRef => r !== null)
    })
  )
  return perDir.flat()
}

/* ---------- Codex: ~/.codex/sessions rollout jsonl files ---------- */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function listJsonlDeep(dir: string, cap = 1500): Promise<string[]> {
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

async function scanCodex(): Promise<AgentSessionRef[]> {
  const files = await listJsonlDeep(join(homedir(), '.codex', 'sessions'))
  const refs = await Promise.all(
    files.map(async (path): Promise<AgentSessionRef | null> => {
      const head: { cwd: string | null; id: string | null; title: string | null; prompts: number } =
        { cwd: null, id: null, title: null, prompts: 0 }
      try {
        const info = await stat(path)
        await forEachJsonlHead(path, HEAD_LINES, (line) => {
          const p =
            line.payload && typeof line.payload === 'object'
              ? (line.payload as Record<string, unknown>)
              : line
          if (!head.cwd && typeof p.cwd === 'string') head.cwd = p.cwd
          if (!head.id) {
            const id = p.id ?? p.session_id
            if (typeof id === 'string') head.id = id
          }
          if (p.type === 'user_message' && !head.title) {
            const text = typeof p.message === 'string' ? p.message : ''
            if (isHumanPrompt(text)) {
              head.prompts += 1
              head.title = text.trim()
            }
          }
        })
        if (!head.cwd) return null
        const sessionId = head.id ?? path.match(UUID_RE)?.[0] ?? null
        if (!sessionId) return null
        return {
          agentId: 'codex',
          sessionId,
          title: head.title?.replace(/\s+/g, ' ').slice(0, 140) || 'Untitled session',
          branch: null,
          cwd: head.cwd,
          lastActive: info.mtimeMs,
          prompts: head.prompts,
          sizeBytes: info.size,
          resumable: true
        }
      } catch {
        return null
      }
    })
  )
  return refs.filter((r): r is AgentSessionRef => r !== null)
}

/* ---------- Grouping ---------- */

interface KnownProject {
  id: string
  path: string
  isGit: boolean
}

/** How recent a transcript mtime must be to count as an active session. */
const ACTIVE_WINDOW_MS = 3 * 60 * 1000

/**
 * Discover all sessions on the machine and group them by project folder.
 * `known` lets the caller mark which folders are already added to openxirp.
 */
export async function discoverAllSessions(
  known: KnownProject[]
): Promise<MachineProjectGroup[]> {
  const [claude, codex, running] = await Promise.all([
    scanClaude().catch(() => []),
    scanCodex().catch(() => []),
    detectRunningAgents().catch(() => [])
  ])

  const onDisk = [...claude, ...codex]
  const now = Date.now()

  const byPath = new Map<string, MachineProjectGroup>()
  const groupFor = (path: string): MachineProjectGroup => {
    let g = byPath.get(path)
    if (!g) {
      const match = known.find((k) => k.path === path)
      g = {
        path,
        name: basename(path) || path,
        addedProjectId: match?.id ?? null,
        isGit: match?.isGit ?? false,
        sessions: [],
        runningCount: 0,
        lastActive: 0
      }
      byPath.set(path, g)
    }
    return g
  }

  // On-disk sessions. "running" starts from per-session freshness: a transcript
  // written in the last few minutes is being actively worked in right now.
  for (const ref of onDisk) {
    const g = groupFor(ref.cwd)
    const fresh = now - ref.lastActive < ACTIVE_WINDOW_MS
    g.sessions.push({ ...ref, running: fresh, pid: null, state: 'idle' })
    if (ref.lastActive > g.lastActive) g.lastActive = ref.lastActive
  }

  // Attach each live process to a single session: the newest transcript in its
  // cwd. If none exists, add a synthetic row so a bare CLI run still appears.
  for (const r of running) {
    if (!r.cwd) continue
    const g = byPath.get(r.cwd)
    const newest = g?.sessions
      .filter((s) => s.agentId === r.agentId && s.pid === null)
      .sort((a, b) => b.lastActive - a.lastActive)[0]
    if (newest) {
      newest.pid = r.pid
      newest.running = true
      continue
    }
    const gg = groupFor(r.cwd)
    gg.sessions.push({
      agentId: r.agentId,
      sessionId: `live:${r.pid}`,
      title: `${r.agentLabel} session (running)`,
      branch: null,
      cwd: r.cwd,
      lastActive: now,
      prompts: 0,
      sizeBytes: 0,
      resumable: false,
      running: true,
      pid: r.pid,
      state: 'working'
    })
    gg.lastActive = Math.max(gg.lastActive, now)
  }

  for (const g of byPath.values()) {
    for (const s of g.sessions) {
      const fresh = now - s.lastActive < WORKING_FRESH_MS
      s.state = fresh ? 'working' : s.pid !== null ? 'waiting' : 'idle'
    }
    g.sessions.sort((a, b) => b.lastActive - a.lastActive)
    g.runningCount = g.sessions.filter((s) => s.running).length
  }

  return [...byPath.values()].sort((a, b) => {
    if (a.runningCount !== b.runningCount) return b.runningCount - a.runningCount
    return b.lastActive - a.lastActive
  })
}

/** Newest transcript mtime for an agent + cwd, as "ms ago"; Infinity if none. */
async function freshestTranscriptMs(agentId: string, cwd: string): Promise<number> {
  const now = Date.now()
  try {
    if (agentId === 'claude-code') {
      const dir = join(homedir(), '.claude', 'projects', encodeClaudeDir(cwd))
      const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
      let newest = 0
      await Promise.all(
        files.map(async (f) => {
          const s = await stat(join(dir, f)).catch(() => null)
          if (s && s.mtimeMs > newest) newest = s.mtimeMs
        })
      )
      return newest ? now - newest : Infinity
    }
  } catch {
    /* fall through */
  }
  // Other agents: we can confirm the process is alive but not cheaply date its
  // transcript, so report "not fresh" and let the caller show it as waiting.
  return Infinity
}

/**
 * A cheap activity snapshot for the command center's live view: which cwds have
 * a running agent right now, and how recently each wrote its transcript. Runs a
 * process scan plus a single readdir per active project, so it is safe to poll.
 */
export async function machinePulse(): Promise<MachinePulse> {
  const running = await detectRunningAgents().catch(() => [])
  const out: MachinePulse = {}
  await Promise.all(
    running.map(async (r) => {
      if (!r.cwd) return
      const freshMs = await freshestTranscriptMs(r.agentId, r.cwd)
      // keep the freshest process per cwd
      const prev = out[r.cwd]
      if (!prev || freshMs < prev.freshMs) {
        out[r.cwd] = { alive: true, freshMs, agentId: r.agentId }
      }
    })
  )
  return out
}
