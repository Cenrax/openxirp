import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffKind, FileNode, GitStatus, GitStatusFile, Session } from '@shared/types'

const REFRESH_MS = 4000

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
  onSelect
}: {
  file: GitStatusFile
  kind: DiffKind
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const code = kind === 'staged' ? file.index : file.working
  return (
    <button className={`git-file ${active ? 'is-active' : ''}`} onClick={onSelect}>
      <span className={`git-file__code code-${letter(code)}`}>{letter(code)}</span>
      <span className="git-file__path">{file.path}</span>
    </button>
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
  const selRef = useRef(sel)
  selRef.current = sel

  const refresh = useCallback(async () => {
    const s = await window.api.gitStatus(session.id)
    setStatus(s)
  }, [session.id])

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
            {group('Staged', staged, 'staged')}
            {group('Changed', changed, 'unstaged')}
            {group('Untracked', untracked, 'untracked')}
          </div>
          <div className="git-diff-wrap">
            {sel ? <DiffView text={diff} /> : <div className="git-empty">Select a file to view its diff.</div>}
          </div>
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
