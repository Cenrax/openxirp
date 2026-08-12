import { create } from 'zustand'
import type {
  AgentInfo,
  AgentSessionRef,
  CreateSessionInput,
  Project,
  Session,
  TranscriptMessage
} from '@shared/types'

type Layout = 'tabs' | 'grid'
type View = 'workspace' | 'history'

interface AppState {
  projects: Project[]
  sessions: Session[]
  agents: AgentInfo[]
  openIds: string[]
  activeId: string | null
  layout: Layout
  dialogProjectId: string | null | undefined // undefined = closed

  view: View
  panelOpen: boolean
  historyProjectId: string | null
  history: AgentSessionRef[]
  historyLoading: boolean
  detail: AgentSessionRef | null
  transcript: TranscriptMessage[]
  transcriptLoading: boolean

  init: () => Promise<void>
  applySnapshot: (snap: { projects: Project[]; sessions: Session[] }) => void
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  createSession: (input: CreateSessionInput) => Promise<void>
  removeSession: (id: string) => Promise<void>
  openSession: (id: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  setLayout: (l: Layout) => void
  togglePanel: () => void
  openDialog: (projectId: string | null) => void
  closeDialog: () => void

  openHistory: (projectId: string) => Promise<void>
  closeHistory: () => void
  resumeSession: (ref: AgentSessionRef) => Promise<void>
  openTranscript: (ref: AgentSessionRef) => Promise<void>
  closeTranscript: () => void
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  sessions: [],
  agents: [],
  openIds: [],
  activeId: null,
  layout: 'tabs',
  dialogProjectId: undefined,

  view: 'workspace',
  panelOpen: false,
  historyProjectId: null,
  history: [],
  historyLoading: false,
  detail: null,
  transcript: [],
  transcriptLoading: false,

  init: async () => {
    const [projects, sessions, agents] = await Promise.all([
      window.api.listProjects(),
      window.api.listSessions(),
      window.api.listAgents()
    ])
    set({ projects, sessions, agents })
  },

  applySnapshot: (snap) => {
    // prune open tabs whose sessions no longer exist
    const alive = new Set(snap.sessions.map((s) => s.id))
    const openIds = get().openIds.filter((id) => alive.has(id))
    let activeId = get().activeId
    if (activeId && !alive.has(activeId)) activeId = openIds[openIds.length - 1] ?? null

    // if the project being viewed in history was removed, fall back to the workspace
    const s = get()
    const historyGone =
      s.view === 'history' &&
      s.historyProjectId !== null &&
      !snap.projects.some((p) => p.id === s.historyProjectId)

    set({
      projects: snap.projects,
      sessions: snap.sessions,
      openIds,
      activeId,
      ...(historyGone ? { view: 'workspace' as const } : {})
    })
  },

  addProject: async () => {
    get().applySnapshot(await window.api.addProject())
  },

  removeProject: async (id) => {
    get().applySnapshot(await window.api.removeProject(id))
  },

  createSession: async (input) => {
    const before = new Set(get().sessions.map((s) => s.id))
    const snap = await window.api.createSession(input)
    get().applySnapshot(snap)
    const created = snap.sessions.find((s) => !before.has(s.id))
    if (created) get().openSession(created.id)
    get().closeDialog()
  },

  removeSession: async (id) => {
    get().applySnapshot(await window.api.removeSession(id))
  },

  openSession: (id) => {
    const openIds = get().openIds.includes(id) ? get().openIds : [...get().openIds, id]
    set({ openIds, activeId: id, view: 'workspace' })
  },

  closeTab: (id) => {
    const openIds = get().openIds.filter((x) => x !== id)
    let activeId = get().activeId
    if (activeId === id) activeId = openIds[openIds.length - 1] ?? null
    set({ openIds, activeId })
  },

  setActive: (id) => set({ activeId: id }),
  setLayout: (layout) => set({ layout }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openDialog: (projectId) => set({ dialogProjectId: projectId }),
  closeDialog: () => set({ dialogProjectId: undefined }),

  openHistory: async (projectId) => {
    set({
      view: 'history',
      historyProjectId: projectId,
      history: [],
      historyLoading: true,
      detail: null,
      transcript: []
    })
    try {
      const history = await window.api.discoverSessions(projectId)
      // ignore if the user navigated away while loading
      if (get().historyProjectId === projectId) set({ history, historyLoading: false })
    } catch {
      if (get().historyProjectId === projectId) set({ history: [], historyLoading: false })
    }
  },

  closeHistory: () => set({ view: 'workspace', detail: null }),

  openTranscript: async (ref) => {
    const projectId = get().historyProjectId
    if (!projectId) return
    set({ detail: ref, transcript: [], transcriptLoading: true })
    try {
      const transcript = await window.api.readTranscript(ref.agentId, projectId, ref.sessionId)
      if (get().detail?.sessionId === ref.sessionId) set({ transcript, transcriptLoading: false })
    } catch {
      if (get().detail?.sessionId === ref.sessionId)
        set({ transcript: [], transcriptLoading: false })
    }
  },

  closeTranscript: () => set({ detail: null, transcript: [] }),

  resumeSession: async (ref) => {
    const projectId = get().historyProjectId
    if (!projectId) return
    await get().createSession({
      projectId,
      name: ref.title,
      agentId: ref.agentId,
      resumeId: ref.sessionId
    })
  }
}))
