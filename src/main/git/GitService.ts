import { simpleGit, SimpleGit } from 'simple-git'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join, relative, sep } from 'path'
import type { DiffKind, FileNode, GitStatus, GitStatusFile } from '@shared/types'

/**
 * Wraps git for worktree isolation. Each session gets its own worktree so
 * agents working in parallel never share a checkout.
 */
export class GitService {
  private root(): string {
    const dir = join(app.getPath('userData'), 'worktrees')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  async isRepo(path: string): Promise<boolean> {
    try {
      const git = simpleGit(path)
      return await git.checkIsRepo()
    } catch {
      return false
    }
  }

  async currentBranch(path: string): Promise<string> {
    const git = simpleGit(path)
    try {
      const b = await git.revparse(['--abbrev-ref', 'HEAD'])
      return b.trim()
    } catch {
      return 'HEAD'
    }
  }

  /**
   * Create a worktree for a session. Returns the worktree path and branch.
   * Falls back to the repo root itself if worktree creation fails, so a
   * session is always usable.
   */
  async createWorktree(
    repoPath: string,
    sessionId: string,
    slug: string
  ): Promise<{ worktreePath: string; branch: string }> {
    const git: SimpleGit = simpleGit(repoPath)
    const branch = `openxirp/${slug}`
    const worktreePath = join(this.root(), sessionId)
    const base = await this.currentBranch(repoPath)

    await git.raw(['worktree', 'add', '-b', branch, worktreePath, base])
    return { worktreePath, branch }
  }

  async removeWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    const git = simpleGit(repoPath)
    try {
      await git.raw(['worktree', 'remove', '--force', worktreePath])
    } catch {
      /* worktree may already be gone */
    }
    try {
      await git.raw(['branch', '-D', branch])
    } catch {
      /* branch may already be gone or checked out elsewhere */
    }
  }

  async initRepo(path: string): Promise<void> {
    const git = simpleGit(path)
    await git.init()
  }

  async status(cwd: string): Promise<GitStatus> {
    if (!(await this.isRepo(cwd))) {
      return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], clean: true }
    }
    const git = simpleGit(cwd)
    const s = await git.status()
    const files: GitStatusFile[] = s.files.map((f) => ({
      path: f.path,
      index: f.index || ' ',
      working: f.working_dir || ' '
    }))
    return {
      isRepo: true,
      branch: s.current ?? 'HEAD',
      ahead: s.ahead ?? 0,
      behind: s.behind ?? 0,
      files,
      clean: files.length === 0
    }
  }

  /** Unified diff for one path. Untracked files are synthesized as all-added. */
  async diff(cwd: string, path: string, kind: DiffKind): Promise<string> {
    const git = simpleGit(cwd)
    if (kind === 'untracked') {
      try {
        const content = await readFile(join(cwd, path), 'utf-8')
        const lines = content.split('\n')
        const capped = lines.slice(0, 2000)
        const body = capped.map((l) => `+${l}`).join('\n')
        const tail = lines.length > capped.length ? '\n… (truncated)' : ''
        return `+++ new file: ${path}\n${body}${tail}`
      } catch {
        return ''
      }
    }
    const args = kind === 'staged' ? ['--cached', '--', path] : ['--', path]
    try {
      return await git.diff(args)
    } catch {
      return ''
    }
  }

  /** Shallow directory listing under the session cwd, dirs first, git noise hidden. */
  async listDir(cwd: string, rel: string): Promise<FileNode[]> {
    const abs = rel ? join(cwd, rel) : cwd
    // guard against path escapes outside the session cwd
    const rp = relative(cwd, abs)
    if (rp.startsWith('..') || rp.includes(`..${sep}`)) return []
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return []
    }
    const hidden = new Set(['.git', 'node_modules', '.DS_Store'])
    const nodes: FileNode[] = entries
      .filter((e) => !hidden.has(e.name))
      .map((e) => ({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        dir: e.isDirectory()
      }))
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    return nodes
  }

  async readFileText(cwd: string, rel: string): Promise<string> {
    const abs = join(cwd, rel)
    const rp = relative(cwd, abs)
    if (rp.startsWith('..') || rp.includes(`..${sep}`)) return ''
    try {
      const content = await readFile(abs, 'utf-8')
      const lines = content.split('\n')
      return lines.length > 3000 ? lines.slice(0, 3000).join('\n') + '\n… (truncated)' : content
    } catch {
      return ''
    }
  }
}
