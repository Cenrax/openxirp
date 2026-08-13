import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'

interface Cmd {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette(): JSX.Element | null {
  const s = useApp()
  const open = s.paletteOpen
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Cmd[]>(() => {
    const close = (): void => s.setPalette(false)
    const wrap = (fn: () => void): (() => void) => () => {
      fn()
      close()
    }
    const cmds: Cmd[] = [
      { id: 'new', label: 'New session', hint: 'action', run: wrap(() => s.openDialog(null)) },
      { id: 'add', label: 'Add project', hint: 'action', run: wrap(() => void s.addProject()) },
      {
        id: 'theme',
        label: s.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        hint: 'view',
        run: wrap(s.toggleTheme)
      },
      {
        id: 'panel',
        label: s.panelOpen ? 'Hide changes panel' : 'Show changes panel',
        hint: 'view',
        run: wrap(s.togglePanel)
      },
      { id: 'tabs', label: 'Layout: Tabs', hint: 'view', run: wrap(() => s.setLayout('tabs')) },
      { id: 'grid', label: 'Layout: Grid', hint: 'view', run: wrap(() => s.setLayout('grid')) }
    ]
    for (const p of s.projects) {
      cmds.push({
        id: `hist:${p.id}`,
        label: `History: ${p.name}`,
        hint: 'project',
        run: wrap(() => void s.openHistory(p.id))
      })
      cmds.push({
        id: `newin:${p.id}`,
        label: `New session in ${p.name}`,
        hint: 'project',
        run: wrap(() => s.openDialog(p.id))
      })
    }
    for (const sess of s.sessions) {
      cmds.push({
        id: `go:${sess.id}`,
        label: `Go to session: ${sess.name}`,
        hint: 'session',
        run: wrap(() => s.openSession(sess.id))
      })
    }
    return cmds
  }, [s])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIdx(0)
    }
  }, [open])

  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') s.setPalette(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[idx]?.run()
    }
  }

  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && s.setPalette(false)}>
      <div className="palette" role="dialog" aria-modal="true">
        <input
          className="palette__input"
          autoFocus
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette__list" ref={listRef}>
          {filtered.length === 0 && <div className="palette__empty">No matching commands</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`palette__item ${i === idx ? 'is-active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => c.run()}
            >
              <span className="palette__label">{c.label}</span>
              {c.hint && <span className="palette__hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
