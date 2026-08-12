export type SessionStatus = 'idle' | 'running' | 'exited'

export interface Project {
  id: string
  name: string
  path: string
  isGit: boolean
  createdAt: number
}

export interface Session {
  id: string
  projectId: string | null
  name: string
  cwd: string
  worktreePath: string | null
  branch: string | null
  agentId: string
  /** when set, the session resumes a prior agent transcript instead of starting fresh */
  resumeId: string | null
  status: SessionStatus
  createdAt: number
}

/** A prior agent conversation discovered on disk for a project. */
export interface AgentSessionRef {
  agentId: string
  sessionId: string
  title: string
  branch: string | null
  cwd: string
  lastActive: number
  prompts: number
  sizeBytes: number
  /** true when this agent can be resumed by id from the CLI */
  resumable: boolean
}

/** One rendered turn in a transcript preview. */
export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool'
  text: string
  tool: string | null
  ts: number | null
}

/** A single changed path in a session's working tree. */
export interface GitStatusFile {
  path: string
  /** staged (index) code, git short-status letter or ' ' */
  index: string
  /** unstaged (working tree) code, git short-status letter or ' ' */
  working: string
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitStatusFile[]
  clean: boolean
}

export type DiffKind = 'staged' | 'unstaged' | 'untracked'

/** An entry in a working-tree directory listing. */
export interface FileNode {
  name: string
  path: string // relative to the session cwd
  dir: boolean
}

export interface AgentInfo {
  id: string
  label: string
  description: string
  installed: boolean
  installHint: string
}

export interface CreateSessionInput {
  projectId: string | null
  name: string
  agentId: string
  /** cwd used only for general (project-less) sessions. */
  cwd?: string
  /** resume a discovered agent transcript by id; skips worktree creation. */
  resumeId?: string | null
}

export interface PtyStartResult {
  id: string
  /** buffered scrollback to replay into a freshly mounted terminal */
  backlog: string
  cols: number
  rows: number
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}
