import { app, shell, BrowserWindow, ipcMain, dialog, Notification } from 'electron'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { CreateSessionInput, Project, Session } from '@shared/types'
import { Store } from './store/Store'
import { PtyManager, type PtyNotifyEvent } from './pty/PtyManager'
import type { SessionState } from '@shared/types'
import { GitService } from './git/GitService'
import {
  discoverAllSessions,
  discoverSessions,
  getAdapter,
  listAgents,
  machinePulse,
  readTranscript
} from './agents/registry'
import { readAllUsage, readSessionUsage } from './agents/usage'

let mainWindow: BrowserWindow | null = null
const store = new Store()
const git = new GitService()

const bellDebounce = new Map<string, number>()

/** Surface a native notification when a session needs attention or ends. */
function notifyAttention(e: PtyNotifyEvent): void {
  if (!Notification.isSupported()) return
  // don't interrupt when the user is already looking at the app
  if (mainWindow && mainWindow.isFocused()) return
  const session = store.findSession(e.id)
  if (!session) return

  if (e.kind === 'bell') {
    const now = Date.now()
    if (now - (bellDebounce.get(e.id) ?? 0) < 5000) return
    bellDebounce.set(e.id, now)
  }

  const title =
    e.kind === 'exit'
      ? 'Session ended'
      : e.kind === 'blocked'
        ? 'Waiting for you'
        : 'Session needs attention'
  const body =
    e.kind === 'exit'
      ? `${session.name} exited (code ${e.code})`
      : e.kind === 'blocked'
        ? `${session.name} is blocked on a prompt`
        : session.name
  const n = new Notification({ title, body })
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.webContents.send(IPC.sessionFocus, e.id)
    }
  })
  n.show()
}

const pty = new PtyManager(() => mainWindow?.webContents ?? null, notifyAttention)

// Poll live session states, push them to the renderer for status dots, and
// notify once when an agent session transitions into a blocked (needs-input) state.
const prevStates = new Map<string, SessionState>()
function tickStates(): void {
  const states = pty.snapshotStates()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.sessionStates, states)
  }
  for (const [id, state] of Object.entries(states)) {
    const prev = prevStates.get(id)
    if (state === 'blocked' && prev && prev !== 'blocked') {
      const session = store.findSession(id)
      if (session && session.agentId !== 'plain') notifyAttention({ kind: 'blocked', id })
    }
    prevStates.set(id, state)
  }
  // drop states for sessions that no longer exist
  for (const id of [...prevStates.keys()]) if (!(id in states)) prevStates.delete(id)
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `${base || 'session'}-${randomUUID().slice(0, 6)}`
}

function snapshot(): { projects: Project[]; sessions: Session[] } {
  return { projects: store.projects, sessions: store.sessions }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#FBFAF8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.projectsList, () => store.projects)
  ipcMain.handle(IPC.sessionsList, () => store.sessions)
  ipcMain.handle(IPC.agentsList, () => listAgents())

  ipcMain.handle(IPC.agentsDiscover, async (_e, projectId: string) => {
    const project = store.findProject(projectId)
    if (!project) return []
    return discoverSessions(project.path)
  })

  ipcMain.handle(
    IPC.agentsTranscript,
    async (_e, agentId: string, projectId: string, sessionId: string) => {
      const project = store.findProject(projectId)
      if (!project) return []
      return readTranscript(agentId, project.path, sessionId)
    }
  )

  ipcMain.handle(IPC.agentsDiscoverAll, async () => {
    const known = store.projects.map((p) => ({ id: p.id, path: p.path, isGit: p.isGit }))
    return discoverAllSessions(known)
  })

  ipcMain.handle(IPC.agentsPulse, () => machinePulse())

  // Read a transcript for a machine-wide session, keyed by its real cwd rather
  // than a stored project. For Claude the cwd reproduces the transcript dir; for
  // Codex/Gemini the readers resolve by session id.
  ipcMain.handle(
    IPC.agentsTranscriptAt,
    async (_e, agentId: string, cwd: string, sessionId: string) => {
      if (sessionId.startsWith('live:')) return []
      return readTranscript(agentId, cwd, sessionId)
    }
  )

  ipcMain.handle(IPC.projectsAdd, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Add project',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return snapshot()
    const path = res.filePaths[0]
    if (store.projects.some((p) => p.path === path)) return snapshot()

    const isGit = await git.isRepo(path)
    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      isGit,
      createdAt: Date.now()
    }
    store.addProject(project)
    return snapshot()
  })

  ipcMain.handle(IPC.projectsAddPath, async (_e, path: string) => {
    if (store.projects.some((p) => p.path === path)) return snapshot()
    const isGit = await git.isRepo(path)
    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      isGit,
      createdAt: Date.now()
    }
    store.addProject(project)
    return snapshot()
  })

  ipcMain.handle(IPC.projectsRemove, async (_e, id: string) => {
    // tear down any sessions (and worktrees) belonging to the project first
    const owned = store.sessions.filter((s) => s.projectId === id)
    const project = store.findProject(id)
    for (const s of owned) {
      pty.kill(s.id)
      if (project?.isGit && s.worktreePath && s.branch) {
        await git.removeWorktree(project.path, s.worktreePath, s.branch)
      }
    }
    store.removeProject(id)
    return snapshot()
  })

  ipcMain.handle(IPC.sessionsCreate, async (_e, input: CreateSessionInput) => {
    let cwd = input.cwd ?? app.getPath('home')
    let worktreePath: string | null = null
    let branch: string | null = null
    const resumeId = input.resumeId ?? null

    const id = randomUUID()

    if (input.projectId) {
      const project = store.findProject(input.projectId)
      if (!project) throw new Error('Project not found')
      cwd = project.path
      // Resumed sessions run in the original checkout: the transcript's file
      // references point there, so a fresh worktree would not line up.
      if (project.isGit && !resumeId) {
        try {
          const wt = await git.createWorktree(project.path, id, slugify(input.name))
          worktreePath = wt.worktreePath
          branch = wt.branch
          cwd = wt.worktreePath
        } catch (err) {
          // fall back to the repo root so the session still opens
          console.error('worktree creation failed, using repo root:', err)
        }
      }
    }

    const session: Session = {
      id,
      projectId: input.projectId,
      name: input.name.trim() || 'Untitled session',
      cwd,
      worktreePath,
      branch,
      agentId: input.agentId,
      resumeId,
      status: 'idle',
      createdAt: Date.now()
    }
    store.addSession(session)
    return snapshot()
  })

  ipcMain.handle(IPC.sessionsRename, (_e, id: string, name: string) => {
    store.updateSession(id, { name: name.trim() || 'Untitled session' })
    return snapshot()
  })

  ipcMain.handle(IPC.sessionsRemove, async (_e, id: string) => {
    const session = store.findSession(id)
    pty.kill(id)
    if (session?.projectId && session.worktreePath && session.branch) {
      const project = store.findProject(session.projectId)
      if (project?.isGit) {
        await git.removeWorktree(project.path, session.worktreePath, session.branch)
      }
    }
    store.removeSession(id)
    return snapshot()
  })

  ipcMain.handle(IPC.ptyStart, (_e, id: string) => {
    const session = store.findSession(id)
    if (!session) throw new Error('Session not found')
    const fresh = !pty.has(id)
    const adapter = getAdapter(session.agentId)
    const bootstrap = fresh
      ? (session.resumeId ? adapter.resumeCommand(session.resumeId) : adapter.launchCommand()) ??
        undefined
      : undefined
    const result = pty.start(id, session.cwd, bootstrap)
    if (session.status !== 'running') store.updateSession(id, { status: 'running' })
    return result
  })

  ipcMain.handle(IPC.gitStatus, (_e, sessionId: string) => {
    const session = store.findSession(sessionId)
    if (!session) return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], clean: true }
    return git.status(session.cwd)
  })

  ipcMain.handle(IPC.gitDiff, (_e, sessionId: string, path: string, kind: 'staged' | 'unstaged' | 'untracked') => {
    const session = store.findSession(sessionId)
    if (!session) return ''
    return git.diff(session.cwd, path, kind)
  })

  ipcMain.handle(IPC.gitListDir, (_e, sessionId: string, rel: string) => {
    const session = store.findSession(sessionId)
    if (!session) return []
    return git.listDir(session.cwd, rel)
  })

  ipcMain.handle(IPC.fileRead, (_e, sessionId: string, rel: string) => {
    const session = store.findSession(sessionId)
    if (!session) return ''
    return git.readFileText(session.cwd, rel)
  })

  ipcMain.handle(IPC.gitStage, (_e, sessionId: string, path: string) => {
    const session = store.findSession(sessionId)
    return session ? git.stage(session.cwd, path) : Promise.resolve()
  })
  ipcMain.handle(IPC.gitUnstage, (_e, sessionId: string, path: string) => {
    const session = store.findSession(sessionId)
    return session ? git.unstage(session.cwd, path) : Promise.resolve()
  })
  ipcMain.handle(IPC.gitStageAll, (_e, sessionId: string) => {
    const session = store.findSession(sessionId)
    return session ? git.stageAll(session.cwd) : Promise.resolve()
  })
  ipcMain.handle(IPC.gitCommit, async (_e, sessionId: string, message: string) => {
    const session = store.findSession(sessionId)
    if (!session) return { ok: false, error: 'Session not found' }
    try {
      const hash = await git.commit(session.cwd, message)
      return { ok: true, hash }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.gitWorktreeInfo, (_e, sessionId: string) => {
    const session = store.findSession(sessionId)
    if (!session || !session.worktreePath || !session.branch || !session.projectId) return null
    const project = store.findProject(session.projectId)
    if (!project) return null
    return git.worktreeInfo(project.path, session.worktreePath, session.branch)
  })

  ipcMain.handle(IPC.gitMerge, async (_e, sessionId: string) => {
    const session = store.findSession(sessionId)
    if (!session || !session.branch || !session.projectId) {
      return { ok: false, error: 'Session has no worktree branch to merge' }
    }
    const project = store.findProject(session.projectId)
    if (!project) return { ok: false, error: 'Project not found' }
    return git.mergeIntoBase(project.path, session.branch)
  })

  ipcMain.handle(IPC.gitOpenPr, async (_e, sessionId: string, title: string) => {
    const session = store.findSession(sessionId)
    if (!session || !session.worktreePath || !session.branch) {
      return { ok: false, error: 'Session has no worktree branch for a PR' }
    }
    const res = await git.openPr(session.worktreePath, session.branch, title)
    if (res.ok && res.url) shell.openExternal(res.url)
    return res
  })

  ipcMain.handle(IPC.agentsUsage, (_e, agentId: string, cwd: string, sessionId: string) => {
    if (sessionId.startsWith('live:')) return null
    return readSessionUsage(agentId, cwd, sessionId)
  })

  ipcMain.handle(IPC.agentsUsageAll, () => readAllUsage())

  ipcMain.on(IPC.ptyInput, (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) =>
    pty.resize(id, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_e, id: string) => pty.kill(id))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openxirp.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerIpc()
  createWindow()

  setInterval(tickStates, 1200)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  pty.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => pty.killAll())
