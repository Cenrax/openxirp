import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AgentInfo,
  AgentSessionRef,
  CreateSessionInput,
  DiffKind,
  FileNode,
  GitStatus,
  MachineProjectGroup,
  MergeResult,
  PrResult,
  Project,
  PtyDataEvent,
  PtyExitEvent,
  PtyStartResult,
  Session,
  SessionUsage,
  TranscriptMessage,
  UsageReport,
  WorktreeInfo
} from '../shared/types'

type Snapshot = { projects: Project[]; sessions: Session[] }

const api = {
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projectsList),
  listSessions: (): Promise<Session[]> => ipcRenderer.invoke(IPC.sessionsList),
  listAgents: (): Promise<AgentInfo[]> => ipcRenderer.invoke(IPC.agentsList),
  discoverSessions: (projectId: string): Promise<AgentSessionRef[]> =>
    ipcRenderer.invoke(IPC.agentsDiscover, projectId),
  discoverAllSessions: (): Promise<MachineProjectGroup[]> =>
    ipcRenderer.invoke(IPC.agentsDiscoverAll),
  readTranscript: (
    agentId: string,
    projectId: string,
    sessionId: string
  ): Promise<TranscriptMessage[]> =>
    ipcRenderer.invoke(IPC.agentsTranscript, agentId, projectId, sessionId),
  readTranscriptAt: (
    agentId: string,
    cwd: string,
    sessionId: string
  ): Promise<TranscriptMessage[]> =>
    ipcRenderer.invoke(IPC.agentsTranscriptAt, agentId, cwd, sessionId),

  addProject: (): Promise<Snapshot> => ipcRenderer.invoke(IPC.projectsAdd),
  addProjectPath: (path: string): Promise<Snapshot> =>
    ipcRenderer.invoke(IPC.projectsAddPath, path),
  removeProject: (id: string): Promise<Snapshot> => ipcRenderer.invoke(IPC.projectsRemove, id),

  createSession: (input: CreateSessionInput): Promise<Snapshot> =>
    ipcRenderer.invoke(IPC.sessionsCreate, input),
  renameSession: (id: string, name: string): Promise<Snapshot> =>
    ipcRenderer.invoke(IPC.sessionsRename, id, name),
  removeSession: (id: string): Promise<Snapshot> => ipcRenderer.invoke(IPC.sessionsRemove, id),

  gitStatus: (sessionId: string): Promise<GitStatus> =>
    ipcRenderer.invoke(IPC.gitStatus, sessionId),
  gitDiff: (sessionId: string, path: string, kind: DiffKind): Promise<string> =>
    ipcRenderer.invoke(IPC.gitDiff, sessionId, path, kind),
  gitListDir: (sessionId: string, rel: string): Promise<FileNode[]> =>
    ipcRenderer.invoke(IPC.gitListDir, sessionId, rel),
  gitStage: (sessionId: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IPC.gitStage, sessionId, path),
  gitUnstage: (sessionId: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IPC.gitUnstage, sessionId, path),
  gitStageAll: (sessionId: string): Promise<void> => ipcRenderer.invoke(IPC.gitStageAll, sessionId),
  gitCommit: (sessionId: string, message: string): Promise<{ ok: boolean; hash?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.gitCommit, sessionId, message),
  gitWorktreeInfo: (sessionId: string): Promise<WorktreeInfo | null> =>
    ipcRenderer.invoke(IPC.gitWorktreeInfo, sessionId),
  gitMerge: (sessionId: string): Promise<MergeResult> => ipcRenderer.invoke(IPC.gitMerge, sessionId),
  gitOpenPr: (sessionId: string, title: string): Promise<PrResult> =>
    ipcRenderer.invoke(IPC.gitOpenPr, sessionId, title),
  fileRead: (sessionId: string, rel: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fileRead, sessionId, rel),

  sessionUsage: (agentId: string, cwd: string, sessionId: string): Promise<SessionUsage | null> =>
    ipcRenderer.invoke(IPC.agentsUsage, agentId, cwd, sessionId),
  usageAll: (): Promise<UsageReport> => ipcRenderer.invoke(IPC.agentsUsageAll),

  ptyStart: (id: string): Promise<PtyStartResult> => ipcRenderer.invoke(IPC.ptyStart, id),
  ptyInput: (id: string, data: string): void => ipcRenderer.send(IPC.ptyInput, id, data),
  ptyResize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.ptyResize, id, cols, rows),
  ptyKill: (id: string): void => ipcRenderer.send(IPC.ptyKill, id),

  onPtyData: (cb: (e: PtyDataEvent) => void): (() => void) => {
    const handler = (_: unknown, payload: PtyDataEvent): void => cb(payload)
    ipcRenderer.on(IPC.ptyData, handler)
    return () => ipcRenderer.removeListener(IPC.ptyData, handler)
  },
  onPtyExit: (cb: (e: PtyExitEvent) => void): (() => void) => {
    const handler = (_: unknown, payload: PtyExitEvent): void => cb(payload)
    ipcRenderer.on(IPC.ptyExit, handler)
    return () => ipcRenderer.removeListener(IPC.ptyExit, handler)
  },
  onSessionFocus: (cb: (id: string) => void): (() => void) => {
    const handler = (_: unknown, id: string): void => cb(id)
    ipcRenderer.on(IPC.sessionFocus, handler)
    return () => ipcRenderer.removeListener(IPC.sessionFocus, handler)
  }
}

export type OpenxirpApi = typeof api

contextBridge.exposeInMainWorld('api', api)
