import { useEffect } from 'react'
import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { HistoryPanel } from './components/HistoryPanel'
import { NewSessionDialog } from './components/NewSessionDialog'

function TopBar(): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const running = sessions.filter((s) => s.status === 'running').length
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark">
          openxirp<span className="dot">.</span>
        </span>
        <span className="topbar__tag">beta</span>
      </div>
      <div className="topbar__spacer" />
      <span className="topbar__meta">
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · {running} running
      </span>
    </header>
  )
}

function WorkBar(): JSX.Element {
  const { sessions, activeId, openIds, layout, panelOpen, setLayout, togglePanel, openDialog } =
    useApp()
  const active = sessions.find((s) => s.id === activeId)
  return (
    <div className="workbar">
      <div style={{ minWidth: 0 }}>
        <div className="workbar__title">{active ? active.name : 'No session'}</div>
        {active && <div className="workbar__sub">{active.cwd}</div>}
      </div>
      <div className="workbar__spacer" />
      {openIds.length > 0 && (
        <div className="seg" title="Layout">
          <button className={layout === 'tabs' ? 'is-on' : ''} onClick={() => setLayout('tabs')}>
            Tabs
          </button>
          <button className={layout === 'grid' ? 'is-on' : ''} onClick={() => setLayout('grid')}>
            Grid
          </button>
        </div>
      )}
      {openIds.length > 0 && (
        <button
          className={`btn ${panelOpen ? 'btn--on' : ''}`}
          onClick={togglePanel}
          title="Toggle changes panel"
        >
          Changes
        </button>
      )}
      <button className="btn btn--accent" onClick={() => openDialog(null)}>
        New session
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const view = useApp((s) => s.view)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <TopBar />
      <Sidebar />
      <main className="main">
        {view === 'history' ? (
          <HistoryPanel />
        ) : (
          <>
            <WorkBar />
            <Workspace />
          </>
        )}
      </main>
      <NewSessionDialog />
    </div>
  )
}
