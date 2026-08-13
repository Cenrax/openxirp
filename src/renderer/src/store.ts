import { create } from 'zustand'
import type {
  AgentInfo,
  AgentSessionRef,
  CreateSessionInput,
  MachineProjectGroup,
  MachinePulse,
  MachineSession,
  Project,
  Session,
  SessionState,
  TranscriptMessage,
  UsageReport
} from '@shared/types'

type Layout = 'tabs' | 'grid'
type View = 'workspace' | 'history' | 'machine'
type Theme = 'light' | 'dark'

function readTheme(): Theme {
  try {
    return localStorage.getItem('openxirp:theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('openxirp:theme', theme)
  } catch {
    /* ignore storage errors */
  }
}

interface AppState {
  projects: Project[]
  sessions: Session[]
  agents: AgentInfo[]
  states: Record<string, SessionState>
  openIds: string[]
  activeId: string | null
  layout: Layout
  dialogProjectId: string | null | undefined // undefined = closed

  theme: Theme
  view: View
  panelOpen: boolean
  paletteOpen: boolean
  historyProjectId: string | null
  history: AgentSessionRef[]
  historyLoading: boolean
  detail: AgentSessionRef | null
  transcript: TranscriptMessage[]
  transcriptLoading: boolean

  machineGroups: MachineProjectGroup[]
  machineLoading: boolean
  machinePulse: MachinePulse
  costs: UsageReport | null
  costsLoading: boolean

  init: () => Promise<void>
  setStates: (states: Record<string, SessionState>) => void
  applySnapshot: (snap: { projects: Project[]; sessions: Session[] }) => void
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  createSession: (input: CreateSessionInput) => Promise<void>
  removeSession: (id: string) => Promise<void>
  openSession: (id: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  setLayout: (l: Layout) => void
  toggleTheme: () => void
  togglePanel: () => void
  setPalette: (open: boolean) => void
  openDialog: (projectId: string | null) => void
  closeDialog: () => void

  openHistory: (projectId: string) => Promise<void>
  closeHistory: () => void
  resumeSession: (ref: AgentSessionRef) => Promise<void>
  openTranscript: (ref: AgentSessionRef) => Promise<void>
  closeTranscript: () => void

  openCommandCenter: () => Promise<void>
  refreshMachine: () => Promise<void>
  refreshPulse: () => Promise<void>
  closeCommandCenter: () => void
  openMachineTranscript: (ref: MachineSession) => Promise<void>
  resumeMachineSession: (ref: MachineSession, group: MachineProjectGroup) => Promise<void>
  addGroupProject: (group: MachineProjectGroup) => Promise<void>
  loadCosts: () => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  sessions: [],
  agents: [],
  states: {},
  openIds: [],
  activeId: null,
  layout: 'tabs',
  dialogProjectId: undefined,

  theme: readTheme(),
  view: 'workspace',
  panelOpen: false,
  paletteOpen: false,
  historyProjectId: null,
  history: [],
  historyLoading: false,
  detail: null,
  transcript: [],
  transcriptLoading: false,

  machineGroups: [],
  machineLoading: false,
  machinePulse: {},
  costs: null,
  costsLoading: false,

  init: async () => {
    const [projects, sessions, agents] = await Promise.all([
      window.api.listProjects(),
      window.api.listSessions(),
      window.api.listAgents()
    ])
    set({ projects, sessions, agents })
  },

  setStates: (states) => set({ states }),

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
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(theme)
    set({ theme })
  },
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
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
  },

  openCommandCenter: async () => {
    set({ view: 'machine', detail: null, transcript: [] })
    await get().refreshMachine()
    void get().refreshPulse()
  },

  refreshMachine: async () => {
    set({ machineLoading: true })
    try {
      const machineGroups = await window.api.discoverAllSessions()
      set({ machineGroups, machineLoading: false })
    } catch {
      set({ machineGroups: [], machineLoading: false })
    }
  },

  refreshPulse: async () => {
    try {
      set({ machinePulse: await window.api.machinePulse() })
    } catch {
      /* keep the last pulse */
    }
  },

  closeCommandCenter: () => set({ view: 'workspace', detail: null, transcript: [] }),

  openMachineTranscript: async (ref) => {
    if (!ref.resumable) return
    set({ detail: ref, transcript: [], transcriptLoading: true })
    try {
      const transcript = await window.api.readTranscriptAt(ref.agentId, ref.cwd, ref.sessionId)
      if (get().detail?.sessionId === ref.sessionId) set({ transcript, transcriptLoading: false })
    } catch {
      if (get().detail?.sessionId === ref.sessionId)
        set({ transcript: [], transcriptLoading: false })
    }
  },

  resumeMachineSession: async (ref, group) => {
    if (ref.resumable) {
      // Resume in the original checkout (a resumeId skips worktree creation).
      await get().createSession({
        projectId: group.addedProjectId,
        name: ref.title,
        agentId: ref.agentId,
        cwd: group.path,
        resumeId: ref.sessionId
      })
    } else {
      // A bare running process: open a plain terminal in its folder, no worktree.
      await get().createSession({
        projectId: null,
        name: `${group.name} terminal`,
        agentId: 'plain',
        cwd: group.path
      })
    }
  },

  addGroupProject: async (group) => {
    if (group.addedProjectId) return
    get().applySnapshot(await window.api.addProjectPath(group.path))
    await get().refreshMachine()
  },

  loadCosts: async () => {
    set({ costsLoading: true })
    try {
      const costs = await window.api.usageAll()
      set({ costs, costsLoading: false })
    } catch {
      set({ costs: null, costsLoading: false })
    }
  }
}))
