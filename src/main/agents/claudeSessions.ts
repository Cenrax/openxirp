import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import type { AgentSessionRef, TranscriptMessage } from '@shared/types'
import { clampText, forEachJsonl, isHumanPrompt, tail } from './transcriptUtils'

/** Claude Code encodes a project's cwd into its transcript directory name. */
function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

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

function projectDir(projectPath: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectDir(projectPath))
}

/** Does a transcript's recorded cwd belong to this project? Guards the lossy encoding. */
function cwdMatches(cwd: string | null, projectPath: string): boolean {
  if (!cwd) return false
  return cwd === projectPath || cwd.startsWith(projectPath + sep)
}

interface Parsed {
  title: string | null
  branch: string | null
  cwd: string | null
  lastTs: number | null
  prompts: number
}

async function parseHead(file: string): Promise<Parsed> {
  const out: Parsed = { title: null, branch: null, cwd: null, lastTs: null, prompts: 0 }
  await forEachJsonl(file, (d) => {
    if (typeof d.cwd === 'string') out.cwd = d.cwd
    if (typeof d.gitBranch === 'string' && d.gitBranch) out.branch = d.gitBranch
    if (typeof d.timestamp === 'string') {
      const ms = Date.parse(d.timestamp)
      if (!Number.isNaN(ms)) out.lastTs = ms
    }
    if (d.type === 'summary' && typeof d.summary === 'string' && !out.title) out.title = d.summary
    if (d.type === 'user') {
      const msg = d.message as { content?: unknown } | undefined
      const text = firstText(msg?.content)
      if (isHumanPrompt(text)) {
        out.prompts += 1
        if (!out.title) out.title = text.trim()
      }
    }
  })
  return out
}

export async function discoverClaudeSessions(projectPath: string): Promise<AgentSessionRef[]> {
  const dir = projectDir(projectPath)
  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const refs = await Promise.all(
    entries.map(async (file): Promise<AgentSessionRef | null> => {
      const full = join(dir, file)
      try {
        const [info, parsed] = await Promise.all([stat(full), parseHead(full)])
        if (!cwdMatches(parsed.cwd, projectPath)) return null
        return {
          agentId: 'claude-code',
          sessionId: file.replace(/\.jsonl$/, ''),
          title: parsed.title?.replace(/\s+/g, ' ').slice(0, 140) || 'Untitled session',
          branch: parsed.branch,
          cwd: parsed.cwd ?? projectPath,
          lastActive: parsed.lastTs ?? info.mtimeMs,
          prompts: parsed.prompts,
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

export async function readClaudeTranscript(
  projectPath: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  const file = join(projectDir(projectPath), `${sessionId}.jsonl`)
  const out: TranscriptMessage[] = []
  await forEachJsonl(file, (d) => {
    const ts = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) || null : null
    const msg = d.message as { content?: unknown } | undefined
    if (d.type === 'user') {
      const text = firstText(msg?.content)
      if (isHumanPrompt(text)) out.push({ role: 'user', text: clampText(text), tool: null, ts })
    } else if (d.type === 'assistant' && Array.isArray(msg?.content)) {
      for (const block of msg!.content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          out.push({ role: 'assistant', text: clampText(block.text), tool: null, ts })
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          out.push({ role: 'tool', text: '', tool: block.name, ts })
        }
      }
    }
  })
  return tail(out)
}
