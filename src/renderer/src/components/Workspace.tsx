import { useApp } from '../store'
import { TerminalView } from './TerminalView'
import { GitPanel } from './GitPanel'
import { effectiveState } from './Sidebar'
import type { Session } from '@shared/types'

function agentLabel(agentId: string, agents: { id: string; label: string }[]): string {
  return agents.find((a) => a.id === agentId)?.label ?? agentId
}

function Pane({ session, visible }: { session: Session; visible: boolean }): JSX.Element {
  const agents = useApp((s) => s.agents)
  const label = agentLabel(session.agentId, agents)
  return (
    <div className="pane" style={visible ? undefined : { display: 'none' }}>
      <div className="pane__head">
        <span className="pane__title">
          {session.name}
          {session.branch ? `  ·  ${session.branch}` : ''}
        </span>
        {session.agentId !== 'plain' && <span className="pane__agent">{label}</span>}
      </div>
      <TerminalView session={session} visible={visible} />
    </div>
  )
}

export function Workspace(): JSX.Element {
  const { sessions, states, openIds, activeId, layout, panelOpen, closeTab, setActive } = useApp()
  const open = openIds.map((id) => sessions.find((s) => s.id === id)).filter(Boolean) as Session[]
  const active = open.find((s) => s.id === activeId) ?? null

  if (open.length === 0) {
    return <EmptyState />
  }

  const cols = Math.min(open.length, layout === 'grid' ? (open.length > 4 ? 3 : 2) : 1)

  return (
    <>
      {layout === 'tabs' && (
        <div className="tabstrip">
          {open.map((s) => (
            <button
              key={s.id}
              className={`tab ${activeId === s.id ? 'is-active' : ''}`}
              onClick={() => setActive(s.id)}
            >
              <span className={`dot ${effectiveState(s.status, states[s.id])}`} />
              <span>{s.name}</span>
              <span
                className="session__close"
                style={{ opacity: 1 }}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(s.id)
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="workarea">
        <div
          className={`panes ${layout === 'grid' ? 'grid' : ''}`}
          style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}
        >
          {layout === 'grid'
            ? open.map((s) => <Pane key={s.id} session={s} visible />)
            : open.map((s) => <Pane key={s.id} session={s} visible={s.id === active?.id} />)}
        </div>
        {panelOpen && active && (
          <aside className="drawer">
            <GitPanel key={active.id} session={active} />
          </aside>
        )}
      </div>
    </>
  )
}

function EmptyState(): JSX.Element {
  const { projects, addProject, openDialog } = useApp()
  return (
    <div className="empty">
      <div className="empty__card">
        <div className="empty__kicker">openxirp</div>
        <h1 className="empty__title">
          One surface. <span className="accent">Many agents.</span>
        </h1>
        <p className="empty__body">
          Run Claude Code and other CLI agents in parallel, each in its own persistent terminal and
          its own git worktree. Nothing shares a checkout, so agents never step on each other.
        </p>
        <div className="empty__actions">
          <button className="btn btn--accent" onClick={() => openDialog(null)}>
            New session
          </button>
          {projects.length === 0 && (
            <button className="btn" onClick={() => void addProject()}>
              Add a project
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
