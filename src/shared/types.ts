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

/** A coding agent detected running live in some terminal on the machine. */
export interface RunningAgentRef {
  agentId: string
  /** best-effort label when the agent is not one openxirp launches (e.g. "cursor") */
  agentLabel: string
  pid: number
  /** working directory the process is running in, or null if it could not be read */
  cwd: string | null
}

/** A discovered session (on-disk transcript and/or a live process) in the machine-wide view. */
export interface MachineSession extends AgentSessionRef {
  /** true when a matching agent process is running in this cwd right now */
  running: boolean
  /** pid of the live process, when running */
  pid: number | null
}

/** All sessions found for one project folder anywhere on the machine. */
export interface MachineProjectGroup {
  /** the real working directory the sessions share */
  path: string
  /** folder basename, for display */
  name: string
  /** true when this folder is already added to openxirp as a project */
  addedProjectId: string | null
  /** whether the folder is a git repository */
  isGit: boolean
  sessions: MachineSession[]
  /** number of sessions with a live process */
  runningCount: number
  /** newest lastActive across the group */
  lastActive: number
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

/** Availability + state of a session worktree's lifecycle actions. */
export interface WorktreeInfo {
  /** the branch this worktree's changes would merge into */
  base: string
  branch: string
  /** commits on the session branch not yet on base */
  commits: number
  /** uncommitted files in the worktree */
  uncommitted: number
  hasRemote: boolean
  gh: boolean
}

export interface MergeResult {
  ok: boolean
  conflict?: boolean
  summary?: string
  error?: string
}

export interface PrResult {
  ok: boolean
  url?: string
  error?: string
}

/** Token counts and estimated cost for a session or a rollup. */
export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  /** the model the tokens are attributed to, when known */
  model: string | null
  /** estimated USD, or null when the model's pricing is unknown */
  costUsd: number | null
}

/** Machine-wide token/cost rollup keyed by project folder. */
export interface UsageReport {
  total: SessionUsage
  byPath: Record<string, SessionUsage>
}

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
