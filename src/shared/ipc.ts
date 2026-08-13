/** Channel names shared between main and renderer. */
export const IPC = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsAddPath: 'projects:addpath',
  projectsRemove: 'projects:remove',

  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsRemove: 'sessions:remove',
  sessionsRename: 'sessions:rename',
  sessionsChanged: 'sessions:changed',

  agentsList: 'agents:list',
  agentsDiscover: 'agents:discover',
  agentsDiscoverAll: 'agents:discoverall',
  agentsPulse: 'agents:pulse',
  agentsTranscript: 'agents:transcript',
  agentsTranscriptAt: 'agents:transcriptat',

  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitListDir: 'git:listdir',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitStageAll: 'git:stageall',
  gitCommit: 'git:commit',
  gitWorktreeInfo: 'git:worktreeinfo',
  gitMerge: 'git:merge',
  gitOpenPr: 'git:openpr',
  fileRead: 'file:read',

  agentsUsage: 'agents:usage',
  agentsUsageAll: 'agents:usageall',

  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',

  sessionFocus: 'session:focus',
  sessionStates: 'session:states'
} as const
