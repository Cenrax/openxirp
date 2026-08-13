import { useApp } from '../store'
import type { Session, SessionState } from '@shared/types'

const STATE_LABEL: Record<string, string> = {
  working: 'Working',
  blocked: 'Waiting for you',
  idle: 'Idle',
  running: 'Running',
  exited: 'Exited'
}

/** Prefer the live runtime state; fall back to the persisted status. */
export function effectiveState(
  status: Session['status'],
  live: SessionState | undefined
): string {
  if (status === 'exited') return 'exited'
  return live ?? status
}

function StatusDot({ state }: { state: string }): JSX.Element {
  return <span className={`dot ${state}`} title={STATE_LABEL[state] ?? state} />
}

export function Sidebar(): JSX.Element {
  const {
    projects,
    sessions,
    states,
    activeId,
    historyProjectId,
    view,
    addProject,
    removeProject,
    removeSession,
    openSession,
    openDialog,
    openHistory
  } = useApp()

  const general = sessions.filter((s) => s.projectId === null)

  const renderSession = (s: Session): JSX.Element => (
    <div
      key={s.id}
      className={`session ${activeId === s.id ? 'is-active' : ''}`}
      onClick={() => openSession(s.id)}
    >
      <StatusDot state={effectiveState(s.status, states[s.id])} />
      <span className="session__name">{s.name}</span>
      <button
        className="session__close"
        title="Delete session"
        onClick={(e) => {
          e.stopPropagation()
          void removeSession(s.id)
        }}
      >
        ×
      </button>
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="eyebrow">Workspace</span>
        <button className="btn btn--ghost btn--icon" title="Add project" onClick={() => void addProject()}>
          +
        </button>
      </div>

      <div className="sidebar__scroll">
        {projects.length === 0 && general.length === 0 && (
          <p style={{ color: 'var(--ink-3)', fontSize: 12, padding: '4px 8px', lineHeight: 1.5 }}>
            No projects yet. Add a folder to start isolating sessions in their own worktrees.
          </p>
        )}

        {projects.map((p) => {
          const owned = sessions.filter((s) => s.projectId === p.id)
          return (
            <div className="project" key={p.id}>
              <div
                className={`project__row ${
                  view === 'history' && historyProjectId === p.id ? 'is-viewing' : ''
                }`}
              >
                <span className="project__name" title={p.path}>
                  {p.name}
                </span>
                <span className={`project__badge ${p.isGit ? '' : 'plain'}`}>
                  {p.isGit ? 'git' : 'local'}
                </span>
                <button
                  className="btn btn--ghost btn--icon"
                  title="Session history"
                  onClick={() => void openHistory(p.id)}
                >
                  ⏱
                </button>
                <button
                  className="btn btn--ghost btn--icon"
                  title="New session"
                  onClick={() => openDialog(p.id)}
                >
                  +
                </button>
                <button
                  className="btn btn--ghost btn--icon"
                  title="Remove project"
                  onClick={() => void removeProject(p.id)}
                >
                  ×
                </button>
              </div>
              {owned.length > 0 && <div className="session-list">{owned.map(renderSession)}</div>}
            </div>
          )
        })}

        {general.length > 0 && (
          <div className="project">
            <div className="project__row">
              <span className="project__name">General sessions</span>
            </div>
            <div className="session-list">{general.map(renderSession)}</div>
          </div>
        )}
      </div>
    </aside>
  )
}
