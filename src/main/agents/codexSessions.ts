import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import type { AgentSessionRef, TranscriptMessage } from '@shared/types'
import { clampText, forEachJsonl, isHumanPrompt, tail } from './transcriptUtils'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function sessionsRoot(): string {
  return join(homedir(), '.codex', 'sessions')
}

/** Codex rollout lines wrap their content under `payload`; older lines are flat. */
function payloadOf(line: Record<string, unknown>): Record<string, unknown> {
  const p = line.payload
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : line
}

/** Join the text-bearing parts of a Codex message content array. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b && typeof b === 'object') {
      const t = (b as { text?: unknown }).text
      if (typeof t === 'string') parts.push(t)
    }
  }
  return parts.join('')
}

interface Extracted {
  role: 'user' | 'assistant' | 'tool' | null
  text: string
  tool: string | null
}

/** Normalise the many Codex line shapes into a single message, or nothing. */
function extract(line: Record<string, unknown>): Extracted {
  const p = payloadOf(line)
  const type = typeof p.type === 'string' ? p.type : ''

  if (type === 'user_message') return { role: 'user', text: String(p.message ?? ''), tool: null }
  if (type === 'agent_message')
    return { role: 'assistant', text: String(p.message ?? ''), tool: null }
  if (type === 'function_call' || type === 'local_shell_call' || type === 'custom_tool_call') {
    const name = typeof p.name === 'string' ? p.name : type
    return { role: 'tool', text: '', tool: name }
  }
  if (type === 'message') {
    const role = p.role === 'assistant' ? 'assistant' : p.role === 'user' ? 'user' : null
    return { role, text: contentText(p.content), tool: null }
  }
  return { role: null, text: '', tool: null }
}

interface Head {
  cwd: string | null
  id: string | null
  ts: number | null
  title: string | null
  prompts: number
}

async function parseHead(file: string): Promise<Head> {
  const out: Head = { cwd: null, id: null, ts: null, title: null, prompts: 0 }
  await forEachJsonl(file, (line) => {
    const p = payloadOf(line)
    if (!out.cwd && typeof p.cwd === 'string') out.cwd = p.cwd
    if (!out.id) {
      const id = p.id ?? p.session_id
      if (typeof id === 'string') out.id = id
    }
    const tsRaw = line.timestamp ?? p.timestamp
    if (typeof tsRaw === 'string') {
      const ms = Date.parse(tsRaw)
      if (!Number.isNaN(ms)) out.ts = ms
    }
    const m = extract(line)
    if (m.role === 'user' && isHumanPrompt(m.text)) {
      out.prompts += 1
      if (!out.title) out.title = m.text.trim()
    }
  })
  return out
}

async function listJsonl(dir: string, cap = 800): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    const files: string[] = []
    for (const e of entries) {
      if (files.length >= cap) break
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        // Node returns parentPath (or path) on Dirent for recursive reads
        const parent = (e as unknown as { parentPath?: string; path?: string }).parentPath ??
          (e as unknown as { path?: string }).path ?? dir
        files.push(join(parent, e.name))
      }
    }
    return files
  } catch {
    return []
  }
}

function cwdMatches(cwd: string | null, projectPath: string): boolean {
  if (!cwd) return false
  return cwd === projectPath || cwd.startsWith(projectPath + sep)
}

export async function discoverCodexSessions(projectPath: string): Promise<AgentSessionRef[]> {
  const files = await listJsonl(sessionsRoot())
  const refs = await Promise.all(
    files.map(async (full): Promise<AgentSessionRef | null> => {
      try {
        const [info, head] = await Promise.all([stat(full), parseHead(full)])
        if (!cwdMatches(head.cwd, projectPath)) return null
        const idFromName = full.match(UUID_RE)?.[0] ?? null
        const sessionId = head.id ?? idFromName
        if (!sessionId) return null
        return {
          agentId: 'codex',
          sessionId,
          title: head.title?.replace(/\s+/g, ' ').slice(0, 140) || 'Untitled session',
          branch: null,
          cwd: head.cwd ?? projectPath,
          lastActive: head.ts ?? info.mtimeMs,
          prompts: head.prompts,
          sizeBytes: info.size,
          resumable: true
        }
      } catch {
        return null
      }
    })
  )
  return refs
    .filter((r): r is AgentSessionRef => r !== null)
    .sort((a, b) => b.lastActive - a.lastActive)
}

export async function findCodexTranscriptFile(
  projectPath: string,
  sessionId: string,
  files?: string[]
): Promise<string | null> {
  const candidates = files ?? (await listJsonl(sessionsRoot()))

  // Prefer the filename fast path, but still verify the transcript's recorded
  // cwd because session IDs are not scoped to a project.
  for (const file of candidates) {
    if (file.match(UUID_RE)?.[0] !== sessionId) continue
    const head = await parseHead(file).catch(() => null)
    if (head && cwdMatches(head.cwd, projectPath)) return file
  }

  // Older rollout filenames may not contain the session ID.
  for (const file of candidates) {
    const head = await parseHead(file).catch(() => null)
    if (head?.id === sessionId && cwdMatches(head.cwd, projectPath)) return file
  }
  return null
}

export async function readCodexTranscript(
  projectPath: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  const target = await findCodexTranscriptFile(projectPath, sessionId)
  if (!target) return []

  const out: TranscriptMessage[] = []
  await forEachJsonl(target, (line) => {
    const ts = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) || null : null
    const m = extract(line)
    if (m.role === 'user' && isHumanPrompt(m.text)) {
      out.push({ role: 'user', text: clampText(m.text), tool: null, ts })
    } else if (m.role === 'assistant' && m.text.trim()) {
      out.push({ role: 'assistant', text: clampText(m.text), tool: null, ts })
    } else if (m.role === 'tool' && m.tool) {
      out.push({ role: 'tool', text: '', tool: m.tool, ts })
    }
  })
  return tail(out)
}
