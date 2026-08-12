import { useApp } from '../store'
import { Markdown, stripMarkdown } from './Markdown'
import type { AgentSessionRef, TranscriptMessage } from '@shared/types'

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

function Row({ session: s }: { session: AgentSessionRef }): JSX.Element {
  const agents = useApp((st) => st.agents)
  const resumeSession = useApp((st) => st.resumeSession)
  const openTranscript = useApp((st) => st.openTranscript)
  return (
    <button className="hist-row" onClick={() => void openTranscript(s)}>
      <div className="hist-row__body">
        <div className="hist-row__title">{stripMarkdown(s.title)}</div>
        <div className="hist-row__meta">
          <span className="hist-chip">{agentLabel(s.agentId, agents)}</span>
          {s.branch && <span className="hist-branch">{s.branch}</span>}
          <span>
            {s.prompts} prompt{s.prompts === 1 ? '' : 's'}
          </span>
          <span className="hist-dot-sep">·</span>
          <span>{relativeTime(s.lastActive)}</span>
        </div>
      </div>
      {s.resumable && (
        <span
          className="btn hist-row__resume"
          role="button"
          onClick={(e) => {
            e.stopPropagation()
            void resumeSession(s)
          }}
        >
          Resume
        </span>
      )}
      <span className="hist-row__chevron">›</span>
    </button>
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
  const { detail, transcript, transcriptLoading, agents, closeTranscript, resumeSession } = useApp()
  if (!detail) return <></>
  return (
    <div className="history">
      <div className="workbar">
        <button className="btn btn--ghost" onClick={closeTranscript}>
          ← Sessions
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="workbar__title">{stripMarkdown(detail.title)}</div>
          <div className="workbar__sub">
            {agentLabel(detail.agentId, agents)}
            {detail.branch ? `  ·  ${detail.branch}` : ''}
          </div>
        </div>
        <div className="workbar__spacer" />
        {detail.resumable && (
          <button className="btn btn--accent" onClick={() => void resumeSession(detail)}>
            Resume
          </button>
        )}
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

export function HistoryPanel(): JSX.Element {
  const { projects, historyProjectId, history, historyLoading, closeHistory, detail } = useApp()
  const project = projects.find((p) => p.id === historyProjectId)

  if (detail) return <TranscriptView />

  return (
    <div className="history">
      <div className="workbar">
        <button className="btn btn--ghost" onClick={closeHistory}>
          ← Back
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="workbar__title">History · {project?.name ?? 'Project'}</div>
          {project && <div className="workbar__sub">{project.path}</div>}
        </div>
      </div>

      <div className="history__scroll">
        {historyLoading && <p className="history__note">Reading agent transcripts…</p>}

        {!historyLoading && history.length === 0 && (
          <div className="history__empty">
            <div className="empty__kicker">Nothing yet</div>
            <p className="history__note">
              No prior agent sessions were found for this folder. Sessions you run here, in openxirp
              or the CLI, will show up to resume later.
            </p>
          </div>
        )}

        {!historyLoading && history.length > 0 && (
          <>
            <div className="history__count">
              {history.length} session{history.length === 1 ? '' : 's'}
            </div>
            <div className="hist-list">
              {history.map((s) => (
                <Row key={`${s.agentId}:${s.sessionId}`} session={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
