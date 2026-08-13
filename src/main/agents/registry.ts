import { execFile } from 'child_process'
import { platform } from 'os'
import type { AgentInfo, AgentSessionRef, TranscriptMessage } from '@shared/types'
import { discoverClaudeSessions, readClaudeTranscript } from './claudeSessions'
import { discoverCodexSessions, readCodexTranscript } from './codexSessions'
import { discoverGeminiSessions, readGeminiTranscript } from './geminiSessions'

export { discoverAllSessions } from './machineSessions'

const NO_SESSIONS = async (): Promise<AgentSessionRef[]> => []
const NO_TRANSCRIPT = async (): Promise<TranscriptMessage[]> => []

export interface AgentAdapter {
  id: string
  label: string
  description: string
  /** command probed on PATH; empty for the plain shell */
  bin: string
  installHint: string
  /** command written into the session shell to start the agent */
  launchCommand(): string | null
  /** command to resume a prior transcript by id, or null if unsupported */
  resumeCommand(sessionId: string): string | null
  /** discover prior transcripts for a project folder */
  discover(projectPath: string): Promise<AgentSessionRef[]>
  /** read a transcript into rendered messages */
  readTranscript(projectPath: string, sessionId: string): Promise<TranscriptMessage[]>
}

const claudeCode: AgentAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  description: 'Anthropic coding agent',
  bin: 'claude',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  launchCommand: () => 'claude',
  resumeCommand: (id) => `claude --resume ${id}`,
  discover: discoverClaudeSessions,
  readTranscript: readClaudeTranscript
}

const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  description: 'OpenAI coding agent',
  bin: 'codex',
  installHint: 'npm install -g @openai/codex',
  launchCommand: () => 'codex',
  resumeCommand: (id) => `codex resume ${id}`,
  discover: discoverCodexSessions,
  readTranscript: readCodexTranscript
}

const gemini: AgentAdapter = {
  id: 'gemini',
  label: 'Gemini',
  description: 'Google coding agent',
  bin: 'gemini',
  installHint: 'npm install -g @google/gemini-cli',
  launchCommand: () => 'gemini',
  resumeCommand: (id) => `gemini --resume ${id}`,
  discover: discoverGeminiSessions,
  readTranscript: readGeminiTranscript
}

const plain: AgentAdapter = {
  id: 'plain',
  label: 'Plain terminal',
  description: 'Raw shell, no agent',
  bin: '',
  installHint: '',
  launchCommand: () => null,
  resumeCommand: () => null,
  discover: NO_SESSIONS,
  readTranscript: NO_TRANSCRIPT
}

const ADAPTERS: AgentAdapter[] = [claudeCode, codex, gemini, plain]

function onPath(bin: string): Promise<boolean> {
  if (!bin) return Promise.resolve(true)
  const finder = platform() === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [bin], (err, stdout) => {
      resolve(!err && stdout.trim().length > 0)
    })
  })
}

export function getAdapter(id: string): AgentAdapter {
  return ADAPTERS.find((a) => a.id === id) ?? plain
}

export async function listAgents(): Promise<AgentInfo[]> {
  return Promise.all(
    ADAPTERS.map(async (a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      installed: await onPath(a.bin),
      installHint: a.installHint
    }))
  )
}

/** Aggregate discovered transcripts across every agent for a project folder. */
export async function discoverSessions(projectPath: string): Promise<AgentSessionRef[]> {
  const lists = await Promise.all(ADAPTERS.map((a) => a.discover(projectPath).catch(() => [])))
  return lists.flat().sort((a, b) => b.lastActive - a.lastActive)
}

export function readTranscript(
  agentId: string,
  projectPath: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  return getAdapter(agentId).readTranscript(projectPath, sessionId)
}
