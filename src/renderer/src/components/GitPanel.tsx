import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffKind, FileNode, GitStatus, GitStatusFile, Session, WorktreeInfo } from '@shared/types'
import { useApp } from '../store'

const REFRESH_MS = 4000
const WT_REFRESH_MS = 6000

/** Merge / open-PR / discard actions for a session's isolated worktree. */
function LifecycleBar({ session }: { session: Session }): JSX.Element | null {
  const removeSession = useApp((s) => s.removeSession)
  const [info, setInfo] = useState<WorktreeInfo | null>(null)
  const [busy, setBusy] = useState<'merge' | 'pr' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setInfo(await window.api.gitWorktreeInfo(session.id))
  }, [session.id])

  useEffect(() => {
    void load()
    const t = setInterval(load, WT_REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (!session.worktreePath || !session.branch) return null

  const merge = async (): Promise<void> => {
    setBusy('merge')
    setMsg(null)
    const r = await window.api.gitMerge(session.id)
    setBusy(null)
    setMsg(r.ok ? { kind: 'ok', text: r.summary || 'Merged' } : { kind: 'err', text: r.error || 'Merge failed' })
    await load()
  }

  const openPr = async (): Promise<void> => {
    setBusy('pr')
    setMsg(null)
    const r = await window.api.gitOpenPr(session.id, session.name)
    setBusy(null)
    setMsg(r.ok ? { kind: 'ok', text: 'Pull request opened in your browser' } : { kind: 'err', text: r.error || 'Could not open PR' })
  }

  const discard = async (): Promise<void> => {
    const ok = window.confirm(
      `Discard this worktree and delete branch ${session.branch}? Uncommitted changes are lost.`
    )
    if (ok) await removeSession(session.id)
  }

  const canMerge = !!info && info.commits > 0 && info.uncommitted === 0
  const canPr = !!info && info.hasRemote && info.gh && info.commits > 0

  const prTitle = !info
    ? ''
    : !info.gh
      ? 'gh CLI not found on PATH'
      : !info.hasRemote
        ? 'No git remote configured'
        : info.commits === 0
          ? 'No commits to open a PR for'
          : 'Push branch and open a pull request'

  return (
    <div className="wt-bar">
      <div className="wt-bar__row">
        <button
          className="btn"
          disabled={!canMerge || busy !== null}
          onClick={() => void merge()}
          title={
            info?.uncommitted ? 'Commit the worktree first' : `Merge ${session.branch} into ${info?.base ?? 'base'}`
          }
        >
          {busy === 'merge' ? 'Merging…' : `Merge to ${info?.base ?? 'base'}`}
        </button>
        <button className="btn" disabled={!canPr || busy !== null} onClick={() => void openPr()} title={prTitle}>
          {busy === 'pr' ? 'Opening…' : 'Open PR'}
        </button>
        <div className="wt-bar__spacer" />
        <button className="btn btn--ghost wt-bar__discard" onClick={() => void discard()} title="Remove worktree and branch">
          Discard
        </button>
      </div>
      {info && (
        <div className="wt-bar__hint">
          {info.commits > 0
            ? `${info.commits} commit${info.commits === 1 ? '' : 's'} ahead of ${info.base}`
            : `Nothing to merge yet · base ${info.base}`}
          {info.uncommitted > 0 ? ` · ${info.uncommitted} uncommitted` : ''}
          {!info.gh ? ' · gh not found' : !info.hasRemote ? ' · no remote' : ''}
        </div>
      )}
      {msg && <div className={`wt-bar__msg ${msg.kind === 'err' ? 'is-err' : 'is-ok'}`}>{msg.text}</div>}
    </div>
  )
}

function letter(code: string): string {
  const c = code.trim()
  if (c === '?') return 'U'
  return c || ' '
}

function DiffView({ text }: { text: string }): JSX.Element {
  if (!text.trim()) return <div className="git-empty">No changes to show.</div>
  return (
    <pre className="diff">
      {text.split('\n').map((line, i) => {
        let cls = 'diff__ctx'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff__add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff__del'
        else if (line.startsWith('@@')) cls = 'diff__hunk'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'))
          cls = 'diff__meta'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function FileRow({
  file,
  kind,
  active,
  onSelect,
  onAct
}: {
  file: GitStatusFile
  kind: DiffKind
  active: boolean
  onSelect: () => void
  onAct: () => void
}): JSX.Element {
  const code = kind === 'staged' ? file.index : file.working
  const staged = kind === 'staged'
  return (
    <div className={`git-file ${active ? 'is-active' : ''}`}>
      <button className="git-file__main" onClick={onSelect}>
        <span className={`git-file__code code-${letter(code)}`}>{letter(code)}</span>
        <span className="git-file__path">{file.path}</span>
      </button>
      <button
        className="git-file__act"
        title={staged ? 'Unstage' : 'Stage'}
        onClick={(e) => {
          e.stopPropagation()
          onAct()
        }}
      >
        {staged ? '−' : '+'}
      </button>
    </div>
  )
}

function Tree({ session, rel, depth }: { session: Session; rel: string; depth: number }): JSX.Element {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null)

  useEffect(() => {
    void window.api.gitListDir(session.id, rel).then(setNodes)
  }, [session.id, rel])

  if (!nodes) return <div className="git-empty" style={{ paddingLeft: depth * 12 }}>…</div>

  return (
    <div>
      {nodes.map((n) =>
        n.dir ? (
          <div key={n.path}>
            <button
              className="tree-row"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => setOpen((o) => ({ ...o, [n.path]: !o[n.path] }))}
            >
              <span className="tree-caret">{open[n.path] ? '▾' : '▸'}</span>
              <span className="tree-name">{n.name}</span>
            </button>
            {open[n.path] && <Tree session={session} rel={n.path} depth={depth + 1} />}
          </div>
        ) : (
          <div key={n.path}>
            <button
              className="tree-row"
              style={{ paddingLeft: 8 + depth * 12 + 14 }}
              onClick={async () => {
                if (preview?.path === n.path) return setPreview(null)
                const text = await window.api.fileRead(session.id, n.path)
                setPreview({ path: n.path, text })
              }}
            >
              <span className="tree-name">{n.name}</span>
            </button>
            {preview?.path === n.path && (
              <pre className="diff diff--plain">{preview.text || '(empty or binary file)'}</pre>
            )}
          </div>
        )
      )}
    </div>
  )
}

export function GitPanel({ session }: { session: Session }): JSX.Element {
  const [tab, setTab] = useState<'changes' | 'files'>('changes')
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [sel, setSel] = useState<{ path: string; kind: DiffKind } | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')
  const selRef = useRef(sel)
  selRef.current = sel

  const refresh = useCallback(async () => {
    const s = await window.api.gitStatus(session.id)
    setStatus(s)
  }, [session.id])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn()
      await refresh()
    },
    [refresh]
  )

  const commit = useCallback(async () => {
    if (!message.trim()) return
    setCommitting(true)
    setCommitError('')
    const res = await window.api.gitCommit(session.id, message.trim())
    setCommitting(false)
    if (res.ok) {
      setMessage('')
      await refresh()
    } else {
      setCommitError(res.error || 'Commit failed')
    }
  }, [message, session.id, refresh])

  useEffect(() => {
    setSel(null)
    setDiff('')
    void refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!sel) {
      setDiff('')
      return
    }
    void window.api.gitDiff(session.id, sel.path, sel.kind).then((d) => {
      if (selRef.current?.path === sel.path && selRef.current?.kind === sel.kind) setDiff(d)
    })
  }, [sel, session.id])

  if (status && !status.isRepo) {
    return (
      <div className="gitpanel">
        <div className="gitpanel__head">
          <span className="eyebrow">Changes</span>
        </div>
        <div className="git-empty">This session is not inside a git repository.</div>
      </div>
    )
  }

  const staged = status?.files.filter((f) => f.index !== ' ' && f.index !== '?') ?? []
  const changed = status?.files.filter((f) => f.working !== ' ' && f.working !== '?') ?? []
  const untracked = status?.files.filter((f) => f.index === '?') ?? []

  const group = (title: string, files: GitStatusFile[], kind: DiffKind): JSX.Element | null =>
    files.length === 0 ? null : (
      <div className="git-group">
        <div className="git-group__title">
          {title} <span className="git-group__count">{files.length}</span>
        </div>
        {files.map((f) => (
          <FileRow
            key={`${kind}:${f.path}`}
            file={f}
            kind={kind}
            active={sel?.path === f.path && sel?.kind === kind}
            onSelect={() => setSel({ path: f.path, kind })}
            onAct={() =>
              void act(() =>
                kind === 'staged'
                  ? window.api.gitUnstage(session.id, f.path)
                  : window.api.gitStage(session.id, f.path)
              )
            }
          />
        ))}
      </div>
    )

  return (
    <div className="gitpanel">
      <div className="gitpanel__head">
        <div className="seg gitpanel__tabs">
          <button className={tab === 'changes' ? 'is-on' : ''} onClick={() => setTab('changes')}>
            Changes
          </button>
          <button className={tab === 'files' ? 'is-on' : ''} onClick={() => setTab('files')}>
            Files
          </button>
        </div>
        <div className="gitpanel__spacer" />
        {status?.isRepo && (
          <span className="gitpanel__branch" title="current branch">
            {status.branch}
            {status.ahead ? ` ↑${status.ahead}` : ''}
            {status.behind ? ` ↓${status.behind}` : ''}
          </span>
        )}
        <button className="btn btn--ghost btn--icon" title="Refresh" onClick={() => void refresh()}>
          ⟳
        </button>
      </div>

      {tab === 'changes' ? (
        <div className="gitpanel__body">
          <div className="git-files">
            {status?.clean && <div className="git-empty">Working tree clean.</div>}
            {(changed.length > 0 || untracked.length > 0) && (
              <button
                className="git-stageall"
                onClick={() => void act(() => window.api.gitStageAll(session.id))}
              >
                + Stage all
              </button>
            )}
            {group('Staged', staged, 'staged')}
            {group('Changed', changed, 'unstaged')}
            {group('Untracked', untracked, 'untracked')}
          </div>
          <div className="git-diff-wrap">
            {sel ? <DiffView text={diff} /> : <div className="git-empty">Select a file to view its diff.</div>}
          </div>
          <div className="git-commit">
            <textarea
              className="git-commit__msg"
              placeholder={staged.length ? 'Commit message' : 'Stage files to commit'}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit()
              }}
              rows={2}
              disabled={staged.length === 0}
            />
            {commitError && <div className="git-commit__err">{commitError}</div>}
            <button
              className="btn btn--accent git-commit__btn"
              disabled={staged.length === 0 || !message.trim() || committing}
              onClick={() => void commit()}
            >
              {committing ? 'Committing…' : `Commit ${staged.length || ''}`.trim()}
            </button>
          </div>
          <LifecycleBar session={session} />
        </div>
      ) : (
        <div className="gitpanel__body">
          <div className="git-tree">
            <Tree session={session} rel="" depth={0} />
          </div>
        </div>
      )}
    </div>
  )
}
