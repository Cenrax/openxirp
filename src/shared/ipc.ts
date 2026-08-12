/** Channel names shared between main and renderer. */
export const IPC = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',

  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsRemove: 'sessions:remove',
  sessionsRename: 'sessions:rename',
  sessionsChanged: 'sessions:changed',

  agentsList: 'agents:list',
  agentsDiscover: 'agents:discover',
  agentsTranscript: 'agents:transcript',

  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitListDir: 'git:listdir',
  fileRead: 'file:read',

  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const
