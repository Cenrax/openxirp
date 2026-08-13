import { useEffect } from 'react'
import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { HistoryPanel } from './components/HistoryPanel'
import { CommandCenter } from './components/CommandCenter'
import { NewSessionDialog } from './components/NewSessionDialog'
import { CommandPalette } from './components/CommandPalette'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

function TopBar(): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const theme = useApp((s) => s.theme)
  const view = useApp((s) => s.view)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const setPalette = useApp((s) => s.setPalette)
  const openCommandCenter = useApp((s) => s.openCommandCenter)
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
      <button
        className={`btn btn--ghost topbar__nav${view === 'machine' ? ' is-on' : ''}`}
        onClick={() => void openCommandCenter()}
        title="See every agent session running on this machine"
      >
        Command center
      </button>
      <span className="topbar__meta">
        {sessions.length} session{sessions.length === 1 ? '' : 's'} · {running} running
      </span>
      <button
        className="topbar__kbd"
        onClick={() => setPalette(true)}
        title="Command palette"
      >
        {IS_MAC ? '⌘K' : 'Ctrl K'}
      </button>
      <button
        className="btn btn--ghost btn--icon topbar__theme"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle color theme"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const st = useApp.getState()
        st.setPalette(!st.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    // clicking a native notification focuses that session
    return window.api.onSessionFocus((id) => useApp.getState().openSession(id))
  }, [])

  useEffect(() => {
    // live working/blocked/idle state pushed from the main process
    return window.api.onSessionStates((states) => useApp.getState().setStates(states))
  }, [])

  return (
    <div className="app">
      <TopBar />
      <Sidebar />
      <main className="main">
        {view === 'history' ? (
          <HistoryPanel />
        ) : view === 'machine' ? (
          <CommandCenter />
        ) : (
          <>
            <WorkBar />
            <Workspace />
          </>
        )}
      </main>
      <NewSessionDialog />
      <CommandPalette />
    </div>
  )
}
