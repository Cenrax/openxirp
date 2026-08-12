import * as pty from 'node-pty'
import { platform } from 'os'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { PtyStartResult } from '@shared/types'

interface Term {
  proc: pty.IPty
  /** rolling scrollback so a remounted xterm can replay recent output */
  backlog: string
  cols: number
  rows: number
  alive: boolean
}

const BACKLOG_LIMIT = 200_000 // characters

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
export class PtyManager {
  private terms = new Map<string, Term>()

  constructor(private sender: () => WebContents | null) {}

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

    const term: Term = { proc, backlog: '', cols, rows, alive: true }
    this.terms.set(id, term)

    proc.onData((data) => {
      term.backlog = (term.backlog + data).slice(-BACKLOG_LIMIT)
      this.push(IPC.ptyData, { id, data })
    })

    proc.onExit(({ exitCode }) => {
      term.alive = false
      this.push(IPC.ptyExit, { id, exitCode })
    })

    // Run an agent (or any bootstrap command) inside the live shell so its
    // output is captured in the same scrollback.
    if (bootstrap) {
      setTimeout(() => proc.write(`${bootstrap}\r`), 250)
    }

    return { id, backlog: '', cols, rows }
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
