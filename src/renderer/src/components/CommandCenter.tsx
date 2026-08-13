import { useApp } from '../store'
import { Markdown, stripMarkdown } from './Markdown'
import { SessionUsageChip, UsageSummary } from './Usage'
import type { MachineProjectGroup, MachineSession, TranscriptMessage } from '@shared/types'

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(ms).toLocaleDateString()
}

function agentLabel(id: string, agents: { id: string; label: string }[]): string {
  return agents.find((a) => a.id === id)?.label ?? id
}

function SessionRow({
  session: s,
  group
}: {
  session: MachineSession
  group: MachineProjectGroup
}): JSX.Element {
  const agents = useApp((st) => st.agents)
  const openMachineTranscript = useApp((st) => st.openMachineTranscript)
  const resumeMachineSession = useApp((st) => st.resumeMachineSession)
  return (
    <button
      className={`cc-row${s.resumable ? '' : ' cc-row--live'}`}
      onClick={() => void openMachineTranscript(s)}
    >
      <span className={`cc-row__pulse${s.running ? ' is-on' : ''}`} aria-hidden />
      <div className="cc-row__body">
        <div className="cc-row__title">{stripMarkdown(s.title)}</div>
        <div className="cc-row__meta">
          <span className="hist-chip">{agentLabel(s.agentId, agents) || s.agentId}</span>
          {s.branch && <span className="hist-branch">{s.branch}</span>}
          {s.prompts > 0 && (
            <span>
              {s.prompts} prompt{s.prompts === 1 ? '' : 's'}
            </span>
          )}
          <span className="hist-dot-sep">·</span>
          <span>{relativeTime(s.lastActive)}</span>
        </div>
      </div>
      <span
        className={`btn ${s.resumable ? 'cc-row__resume' : 'btn--ghost cc-row__open'}`}
        role="button"
        onClick={(e) => {
          e.stopPropagation()
          void resumeMachineSession(s, group)
        }}
      >
        {s.resumable ? 'Resume' : 'Open terminal'}
      </span>
      {s.resumable && <span className="hist-row__chevron">›</span>}
    </button>
  )
}

function Group({ group }: { group: MachineProjectGroup }): JSX.Element {
  const addGroupProject = useApp((st) => st.addGroupProject)
  const costs = useApp((st) => st.costs)
  const usage = costs?.byPath[group.path]
  return (
    <section className="cc-group">
      <header className="cc-group__head">
        <div style={{ minWidth: 0 }}>
          <div className="cc-group__name">
            {group.name}
            {group.addedProjectId && <span className="cc-tag cc-tag--added">Added</span>}
            {group.runningCount > 0 && (
              <span className="cc-tag cc-tag--live">{group.runningCount} running</span>
            )}
          </div>
          <div className="cc-group__path">{group.path}</div>
        </div>
        <div className="cc-group__spacer" />
        {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && <UsageSummary usage={usage} />}
        <span className="cc-group__count">
          {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
        </span>
        {!group.addedProjectId && (
          <button
            className="btn btn--ghost"
            onClick={() => void addGroupProject(group)}
            title="Add this folder as an openxirp project"
          >
            Add project
          </button>
        )}
      </header>
      <div className="cc-list">
        {group.sessions.map((s) => (
          <SessionRow key={`${s.agentId}:${s.sessionId}`} session={s} group={group} />
        ))}
      </div>
    </section>
  )
}

function TurnBlock({ m }: { m: TranscriptMessage }): JSX.Element {
  if (m.role === 'tool') {
    return (
      <div className="turn turn--tool">
        <span className="turn__tool-mark">→</span>
        {m.tool}
      </div>
    )
  }
  return (
    <div className={`turn turn--${m.role}`}>
      <div className="turn__role">{m.role === 'user' ? 'Prompt' : 'Agent'}</div>
      <div className="turn__text">
        <Markdown text={m.text} />
      </div>
    </div>
  )
}

function TranscriptView(): JSX.Element {
  const { detail, transcript, transcriptLoading, agents, closeTranscript } = useApp()
  if (!detail) return <></>
  return (
    <div className="history">
      <div className="workbar">
        <button className="btn btn--ghost" onClick={closeTranscript}>
          ← All sessions
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="workbar__title">{stripMarkdown(detail.title)}</div>
          <div className="workbar__sub">
            {agentLabel(detail.agentId, agents) || detail.agentId}
            {'  ·  '}
            {detail.cwd}
          </div>
        </div>
        <div className="workbar__spacer" />
        <SessionUsageChip agentId={detail.agentId} cwd={detail.cwd} sessionId={detail.sessionId} />
      </div>

      <div className="transcript">
        {transcriptLoading && <p className="history__note">Reading transcript…</p>}
        {!transcriptLoading && transcript.length === 0 && (
          <p className="history__note">
            This transcript could not be previewed. You can still resume it.
          </p>
        )}
        {transcript.map((m, i) => (
          <TurnBlock key={i} m={m} />
        ))}
      </div>
    </div>
  )
}

export function CommandCenter(): JSX.Element {
  const { machineGroups, machineLoading, refreshMachine, closeCommandCenter, detail } = useApp()
  const costs = useApp((s) => s.costs)
  const costsLoading = useApp((s) => s.costsLoading)
  const loadCosts = useApp((s) => s.loadCosts)

  if (detail) return <TranscriptView />

  const totalSessions = machineGroups.reduce((n, g) => n + g.sessions.length, 0)
  const totalRunning = machineGroups.reduce((n, g) => n + g.runningCount, 0)

  return (
    <div className="history">
      <div className="workbar">
        <button className="btn btn--ghost" onClick={closeCommandCenter}>
          ← Back
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="workbar__title">Command center</div>
          <div className="workbar__sub">
            Every coding-agent session on this machine, added here or not
          </div>
        </div>
        <div className="workbar__spacer" />
        {costs && <UsageSummary usage={costs.total} />}
        <span className="topbar__meta">
          {totalRunning} running · {totalSessions} total
        </span>
        <button className="btn" onClick={() => void loadCosts()} disabled={costsLoading} title="Estimate token usage and cost across every session">
          {costsLoading ? 'Estimating…' : costs ? 'Recalc cost' : 'Estimate cost'}
        </button>
        <button className="btn" onClick={() => void refreshMachine()} disabled={machineLoading}>
          {machineLoading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      <div className="history__scroll">
        {machineLoading && machineGroups.length === 0 && (
          <p className="history__note">Scanning the machine for agent sessions…</p>
        )}

        {!machineLoading && machineGroups.length === 0 && (
          <div className="history__empty">
            <div className="empty__kicker">Nothing found</div>
            <p className="history__note">
              No Claude Code, Codex, or Gemini sessions were found on disk, and no agent process is
              running. Start one anywhere and it will show up here.
            </p>
          </div>
        )}

        {machineGroups.map((g) => (
          <Group key={g.path} group={g} />
        ))}
      </div>
    </div>
  )
}
