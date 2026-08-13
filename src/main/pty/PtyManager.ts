import * as pty from 'node-pty'
import { platform } from 'os'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { PtyStartResult, SessionState } from '@shared/types'

interface Term {
  proc: pty.IPty
  /** rolling scrollback so a remounted xterm can replay recent output */
  backlog: string
  cols: number
  rows: number
  alive: boolean
  /** wall-clock of the last output chunk, for the working/idle heuristic */
  lastDataAt: number
  /** wall-clock of the last terminal bell, a strong "needs input" hint */
  bellAt: number
}

const BACKLOG_LIMIT = 200_000 // characters

/** Output within this window counts as actively working. Agents pause a beat
 *  between tool calls, so the window is generous to avoid flapping to idle. */
const WORKING_QUIET_MS = 2500

// Control sequences (CSI + OSC) stripped before pattern-matching the tail.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g

// Signs the agent is actively producing: its interrupt hint, status glyphs, or
// a braille spinner (U+2800..U+28FF).
const WORKING_RE = /(esc to interrupt|to interrupt|✻|✳|thinking[.…]|[⠀-⣿])/i

// Signs the agent has stopped and is waiting on a human decision.
const BLOCKED_RES: RegExp[] = [
  /\bdo you want to\b/i,
  /\bwould you like\b/i,
  /\((?:y\/n|yes\/no)\)/i,
  /\[(?:y\/n|Y\/n|y\/N)\]/,
  /press enter to continue/i,
  /\b(?:proceed|overwrite|continue|confirm|approve)\?\s*$/im,
  /❯\s*\d+\.\s/,
  /\b1\.\s.+[\s\S]{0,240}\n.*\b2\.\s/
]

/**
 * Pure state classifier, exported for testing. Given a raw terminal backlog and
 * timing, decide whether the session is working, blocked, idle, or exited.
 */
export function classifyTail(
  backlog: string,
  quietMs: number,
  bellAgoMs: number,
  alive: boolean
): SessionState {
  if (!alive) return 'exited'
  const tail = backlog
    .replace(ANSI_RE, '')
    .split('\n')
    .map((l) => l.replace(/\r/g, '').trimEnd())
    .filter((l) => l.trim())
    .slice(-24)
    .join('\n')

  const working = quietMs < WORKING_QUIET_MS || WORKING_RE.test(tail)
  if (!working) {
    const recentBell = bellAgoMs < 12_000
    if (recentBell || BLOCKED_RES.some((re) => re.test(tail))) return 'blocked'
  }
  return working ? 'working' : 'idle'
}

function defaultShell(): { shell: string; args: string[] } {
  if (platform() === 'win32') {
    return { shell: process.env.COMSPEC || 'powershell.exe', args: [] }
  }
  return { shell: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

/**
 * Owns every PTY. Processes live here (not in the renderer) so a session's
 * terminal keeps running when its tab is not mounted, and its output is
 * buffered for replay on reopen.
 */
export type PtyNotifyEvent =
  | { kind: 'bell'; id: string }
  | { kind: 'exit'; id: string; code: number }
  | { kind: 'blocked'; id: string }

export class PtyManager {
  private terms = new Map<string, Term>()

  constructor(
    private sender: () => WebContents | null,
    private notify?: (e: PtyNotifyEvent) => void
  ) {}

  private push(channel: string, payload: unknown): void {
    const wc = this.sender()
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  has(id: string): boolean {
    return this.terms.has(id)
  }

  /** Ensure a PTY exists for the session and return replay backlog. */
  start(id: string, cwd: string, bootstrap?: string): PtyStartResult {
    const existing = this.terms.get(id)
    if (existing) {
      return { id, backlog: existing.backlog, cols: existing.cols, rows: existing.rows }
    }

    const { shell, args } = defaultShell()
    const cols = 80
    const rows = 24
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    })

    const term: Term = {
      proc,
      backlog: '',
      cols,
      rows,
      alive: true,
      lastDataAt: Date.now(),
      bellAt: 0
    }
    this.terms.set(id, term)

    proc.onData((data) => {
      term.backlog = (term.backlog + data).slice(-BACKLOG_LIMIT)
      term.lastDataAt = Date.now()
      this.push(IPC.ptyData, { id, data })
      // a terminal bell (BEL) is the agent/CLI asking for attention
      if (data.includes('\x07')) {
        term.bellAt = Date.now()
        this.notify?.({ kind: 'bell', id })
      }
    })

    proc.onExit(({ exitCode }) => {
      term.alive = false
      this.push(IPC.ptyExit, { id, exitCode })
      this.notify?.({ kind: 'exit', id, code: exitCode })
    })

    // Run an agent (or any bootstrap command) inside the live shell so its
    // output is captured in the same scrollback.
    if (bootstrap) {
      setTimeout(() => proc.write(`${bootstrap}\r`), 250)
    }

    return { id, backlog: '', cols, rows }
  }

  /** State of every live session, keyed by session id. */
  snapshotStates(): Record<string, SessionState> {
    const now = Date.now()
    const out: Record<string, SessionState> = {}
    for (const [id, term] of this.terms) {
      out[id] = classifyTail(term.backlog, now - term.lastDataAt, now - term.bellAt, term.alive)
    }
    return out
  }

  write(id: string, data: string): void {
    this.terms.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const term = this.terms.get(id)
    if (!term || !term.alive) return
    term.cols = cols
    term.rows = rows
    try {
      term.proc.resize(cols, rows)
    } catch {
      /* pty may have exited between checks */
    }
  }

  kill(id: string): void {
    const term = this.terms.get(id)
    if (!term) return
    try {
      term.proc.kill()
    } catch {
      /* already gone */
    }
    this.terms.delete(id)
  }

  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id)
  }
}
