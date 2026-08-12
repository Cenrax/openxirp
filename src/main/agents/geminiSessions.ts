import { readdir, readFile, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentSessionRef, TranscriptMessage } from '@shared/types'
import { clampText, isHumanPrompt, tail } from './transcriptUtils'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Gemini CLI keys per-project storage by a sha256 of the project root path. */
function projectHash(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex')
}

/** Candidate directories Gemini writes chats/checkpoints into. */
function chatDirs(projectPath: string): string[] {
  const base = join(homedir(), '.gemini', 'tmp', projectHash(projectPath))
  return [join(base, 'chats'), base]
}

type Part = { text?: unknown; functionCall?: { name?: unknown }; functionResponse?: unknown }
type Turn = { role?: unknown; parts?: unknown; content?: unknown }

/** Pull the message list out of the several shapes Gemini has used. */
function turnsOf(parsed: unknown): Turn[] {
  if (Array.isArray(parsed)) return parsed as Turn[]
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    for (const key of ['messages', 'history', 'turns', 'contents']) {
      if (Array.isArray(o[key])) return o[key] as Turn[]
    }
  }
  return []
}

function partsText(parts: unknown): string {
  if (typeof parts === 'string') return parts
  if (!Array.isArray(parts)) return ''
  const out: string[] = []
  for (const p of parts as Part[]) {
    if (p && typeof p === 'object' && typeof p.text === 'string') out.push(p.text)
  }
  return out.join('')
}

function normalizeRole(role: unknown): 'user' | 'assistant' | null {
  if (role === 'user') return 'user'
  if (role === 'model' || role === 'assistant') return 'assistant'
  return null
}

async function readChatFiles(projectPath: string): Promise<string[]> {
  for (const dir of chatDirs(projectPath)) {
    try {
      const files = (await readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(dir, f))
      if (files.length) return files
    } catch {
      /* try next candidate */
    }
  }
  return []
}

function sessionIdFor(file: string, parsed: unknown): string {
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    const id = o.sessionId ?? o.id
    if (typeof id === 'string') return id
  }
  const stem = file.split('/').pop()!.replace(/\.json$/, '')
  return stem.match(UUID_RE)?.[0] ?? stem
}

export async function discoverGeminiSessions(projectPath: string): Promise<AgentSessionRef[]> {
  const files = await readChatFiles(projectPath)
  const refs = await Promise.all(
    files.map(async (file): Promise<AgentSessionRef | null> => {
      try {
        const [info, raw] = await Promise.all([stat(file), readFile(file, 'utf-8')])
        const parsed = JSON.parse(raw)
        const turns = turnsOf(parsed)
        let title: string | null = null
        let prompts = 0
        for (const t of turns) {
          if (normalizeRole(t.role) === 'user') {
            const text = partsText(t.parts ?? t.content)
            if (isHumanPrompt(text)) {
              prompts += 1
              if (!title) title = text.trim()
            }
          }
        }
        return {
          agentId: 'gemini',
          sessionId: sessionIdFor(file, parsed),
          title: title?.replace(/\s+/g, ' ').slice(0, 140) || 'Untitled session',
          branch: null,
          cwd: projectPath,
          lastActive: info.mtimeMs,
          prompts,
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

export async function readGeminiTranscript(
  projectPath: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  const files = await readChatFiles(projectPath)
  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf-8')
      const parsed = JSON.parse(raw)
      if (sessionIdFor(file, parsed) !== sessionId) continue
      const out: TranscriptMessage[] = []
      for (const t of turnsOf(parsed)) {
        const role = normalizeRole(t.role)
        const parts = (t.parts ?? t.content) as unknown
        // tool calls
        if (Array.isArray(parts)) {
          for (const p of parts as Part[]) {
            if (p && typeof p === 'object' && p.functionCall && typeof p.functionCall === 'object') {
              const name = (p.functionCall as { name?: unknown }).name
              out.push({ role: 'tool', text: '', tool: typeof name === 'string' ? name : 'tool', ts: null })
            }
          }
        }
        const text = partsText(parts)
        if (role && text.trim()) {
          if (role === 'user' && !isHumanPrompt(text)) continue
          out.push({ role, text: clampText(text), tool: null, ts: null })
        }
      }
      return tail(out)
    } catch {
      /* try next file */
    }
  }
  return []
}
