import { simpleGit, SimpleGit } from 'simple-git'
import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join, relative, sep } from 'path'
import { platform } from 'os'
import type {
  DiffKind,
  FileNode,
  GitStatus,
  GitStatusFile,
  MergeResult,
  PrResult,
  WorktreeInfo
} from '@shared/types'

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

  async stage(cwd: string, path: string): Promise<void> {
    await simpleGit(cwd).add(['--', path])
  }

  async unstage(cwd: string, path: string): Promise<void> {
    // reset the path out of the index; tolerate a repo with no HEAD yet
    try {
      await simpleGit(cwd).raw(['reset', '-q', 'HEAD', '--', path])
    } catch {
      await simpleGit(cwd).raw(['rm', '--cached', '-q', '--', path])
    }
  }

  async stageAll(cwd: string): Promise<void> {
    await simpleGit(cwd).add(['-A'])
  }

  /** Commit the staged index. Returns the new short hash, or throws with a reason. */
  async commit(cwd: string, message: string): Promise<string> {
    const git = simpleGit(cwd)
    const res = await git.commit(message)
    return res.commit || ''
  }

  private async hasRemote(cwd: string): Promise<boolean> {
    try {
      return (await simpleGit(cwd).getRemotes()).length > 0
    } catch {
      return false
    }
  }

  private ghAvailable(): Promise<boolean> {
    const finder = platform() === 'win32' ? 'where' : 'which'
    return new Promise((resolve) => {
      execFile(finder, ['gh'], (err, stdout) => resolve(!err && stdout.trim().length > 0))
    })
  }

  /**
   * Everything the Changes panel needs to decide which lifecycle actions are
   * available for a session's worktree: the base branch it would merge into,
   * how many commits are ahead of that base, whether the worktree is dirty, and
   * whether a remote and the gh CLI exist for opening a PR.
   */
  async worktreeInfo(
    repoPath: string,
    worktreePath: string,
    branch: string
  ): Promise<WorktreeInfo> {
    const base = await this.currentBranch(repoPath)
    let commits = 0
    try {
      const out = await simpleGit(worktreePath).raw(['rev-list', '--count', `${base}..HEAD`])
      commits = parseInt(out.trim(), 10) || 0
    } catch {
      /* base may be unrelated or missing */
    }
    let uncommitted = 0
    try {
      uncommitted = (await simpleGit(worktreePath).status()).files.length
    } catch {
      /* ignore */
    }
    const [hasRemote, gh] = await Promise.all([this.hasRemote(worktreePath), this.ghAvailable()])
    return { base, branch, commits, uncommitted, hasRemote, gh }
  }

  /**
   * Merge a session's branch into the base branch checked out in the main repo.
   * The main checkout must be clean; conflicts are aborted and reported so the
   * repo is never left mid-merge.
   */
  async mergeIntoBase(repoPath: string, branch: string): Promise<MergeResult> {
    const git = simpleGit(repoPath)
    try {
      const st = await git.status()
      if (st.files.length > 0) {
        return {
          ok: false,
          error: `The main checkout has ${st.files.length} uncommitted change(s). Commit or stash them first.`
        }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    try {
      const res = await git.merge(['--no-edit', branch])
      const summary = res.merges && res.merges.length > 0 ? 'Merged' : 'Fast-forwarded'
      return { ok: true, summary: `${summary} ${branch}` }
    } catch (err) {
      // simple-git throws on conflict; leave the repo clean.
      try {
        await git.merge(['--abort'])
      } catch {
        /* nothing to abort */
      }
      const msg = err instanceof Error ? err.message : String(err)
      const conflict = /conflict/i.test(msg)
      return {
        ok: false,
        conflict,
        error: conflict
          ? 'Merge hit conflicts and was aborted. Resolve them manually.'
          : `Merge failed: ${msg}`
      }
    }
  }

  /**
   * Push a session branch and open a pull request with the gh CLI. Returns the
   * PR URL on success. Requires a remote and gh to be installed.
   */
  async openPr(worktreePath: string, branch: string, title: string): Promise<PrResult> {
    try {
      await simpleGit(worktreePath).push(['-u', 'origin', branch])
    } catch (err) {
      return { ok: false, error: `Push failed: ${err instanceof Error ? err.message : String(err)}` }
    }
    return new Promise((resolve) => {
      execFile(
        'gh',
        ['pr', 'create', '--head', branch, '--title', title || branch, '--body', 'Opened from openxirp.'],
        { cwd: worktreePath },
        (err, stdout, stderr) => {
          if (err) {
            resolve({ ok: false, error: (stderr || err.message).trim() || 'gh pr create failed' })
            return
          }
          const url =
            stdout
              .trim()
              .split('\n')
              .find((l) => l.startsWith('http')) ?? stdout.trim()
          resolve({ ok: true, url })
        }
      )
    })
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
