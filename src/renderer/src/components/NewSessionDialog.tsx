import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'

export function NewSessionDialog(): JSX.Element | null {
  const { dialogProjectId, projects, agents, closeDialog, createSession } = useApp()
  const open = dialogProjectId !== undefined

  const [projectId, setProjectId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState('claude-code')
  const [busy, setBusy] = useState(false)

  const preselected = typeof dialogProjectId === 'string'

  useEffect(() => {
    if (!open) return
    setProjectId(typeof dialogProjectId === 'string' ? dialogProjectId : null)
    setName('')
    setBusy(false)
  }, [open, dialogProjectId])

  const selectedAgent = useMemo(() => agents.find((a) => a.id === agentId), [agents, agentId])

  if (!open) return null

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await createSession({
        projectId,
        name: name.trim() || `session ${new Date().toLocaleTimeString()}`,
        agentId
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog__head">
          <h2 className="dialog__title">New session</h2>
          <p className="dialog__sub">
            A project session opens in its own git worktree. A general session runs in your home
            directory.
          </p>
        </div>

        <div className="dialog__body">
          {!preselected && (
            <div className="field">
              <label className="field__label">Project</label>
              <select
                className="input"
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
              >
                <option value="">General (no project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.isGit ? '(git)' : '(local)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label className="field__label">Name</label>
            <input
              className="input"
              autoFocus
              placeholder="Describe the task"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>

          <div className="field">
            <label className="field__label">Agent</label>
            <div className="agent-grid">
              {agents.map((a) => (
                <button
                  key={a.id}
                  className={`agent-opt ${agentId === a.id ? 'is-on' : ''}`}
                  onClick={() => setAgentId(a.id)}
                >
                  <span className="agent-opt__name">
                    {a.label}
                    <span className={`agent-opt__flag ${a.installed ? 'on' : 'off'}`}>
                      {a.installed ? 'ready' : 'missing'}
                    </span>
                  </span>
                  <span className="agent-opt__desc">{a.description}</span>
                </button>
              ))}
            </div>
          </div>

          {selectedAgent && !selectedAgent.installed && selectedAgent.installHint && (
            <div className="hint">
              {selectedAgent.label} was not found on your PATH. Install it, then start the session:
              <br />
              {selectedAgent.installHint}
            </div>
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn btn--ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn btn--accent" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </div>
    </div>
  )
}
