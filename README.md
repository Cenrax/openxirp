<div align="center">

# openxirp

**Run AI coding agents across isolated projects and sessions — in parallel, safely.**

An open-source, cross-platform desktop app that runs Claude Code, Codex, Gemini CLI,
and other CLI agents in parallel, each in its own persistent terminal and its own
git worktree — so nothing shares a checkout and agents never step on each other.

[![Build](https://img.shields.io/github/actions/workflow/status/openxirp/openxirp/build.yml?label=build)](https://github.com/openxirp/openxirp/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)]()
[![Electron](https://img.shields.io/badge/electron-33-blueviolet)](https://www.electronjs.org/)

<a href="docs/openxirp-promo.mp4">
  <img src="docs/openxirp-promo.gif" alt="openxirp — one surface, many agents. A 35-second product tour." width="100%">
</a>

<sub><a href="docs/openxirp-promo.mp4">▶ Watch the full-quality video (MP4)</a></sub>

</div>

---

## Why openxirp?

AI coding agents are powerful, but running several of them against the same folder
quickly turns into chaos: shared checkouts, clobbered branches, and terminals that
die when you switch away. openxirp gives each agent its own isolated workspace:

- **Git worktree isolation** — every session gets its own branch and checkout.
  Run five agents on five tasks in the same repo without conflicts.
- **Persistent terminals** — terminals live in the Electron main process, not the
  UI. Sessions keep running when you switch tabs, and scrollback is replayed when
  a terminal is remounted.
- **Agent-agnostic** — a small adapter interface launches any CLI coding agent.
  Claude Code, Codex, and Gemini CLI ship in the box, plus a plain shell.
- **Session history & resume** — discover transcripts your agents already wrote
  on disk, preview the conversation, and resume it in one click.

openxirp does not replace your coding agent or your source control provider.
Each agent stays authenticated and configured through its own native CLI.

## Features

- **Projects & sessions** — add local folders as projects; create sessions with a
  chosen agent, branch, and isolated worktree. General sessions run a plain shell
  anywhere on your machine.
- **Terminal grid & tabs** — xterm.js-powered terminals arranged in tabs or a
  grid, so you can watch multiple agents work side by side.
- **Agent registry with install detection** — the app probes your `PATH` and shows
  which agents are installed, with an install hint for the ones that aren't.
- **Transcript discovery & resume** — reads prior sessions from
  `~/.claude/projects`, Codex, and Gemini transcript stores, verifies each
  transcript's recorded working directory against the project, and resumes with
  e.g. `claude --resume <id>`.
- **Changes panel** — a per-session git drawer showing branch and ahead/behind,
  staged / changed / untracked files, and a click-to-view unified diff, plus a
  Files tree for browsing the working tree. Refreshes as the agent works.
- **Light and dark themes** — the same editorial design in warm paper or warm
  near-black, including the terminals. Toggle in the top bar; the choice persists.
- **Commit from the app** — stage, unstage, stage-all, and commit staged files
  straight from the Changes panel.
- **Worktree lifecycle** — when a session's work is committed, merge its branch
  back into the base branch, open a pull request with the `gh` CLI, or discard
  the worktree and branch, all from the Changes panel.
- **Token and cost estimates** — per-session token counts with an estimated
  cost (read from transcripts), plus a machine-wide per-project cost rollup in
  the command center.
- **Command center** — one view of every coding-agent session on your machine,
  grouped by project folder, whether or not the folder is added to openxirp. It
  merges on-disk transcripts (Claude Code, Codex, Gemini) with a live scan of
  running agent processes, marks which sessions are active right now, and lets
  you resume any of them or add its folder as a project in one click.
- **Command palette** — Cmd/Ctrl + K to jump to any project, session, or action.
- **Desktop notifications** — get pinged when a session rings the terminal bell
  for attention or its process exits, while the window is in the background.
- **Cross-platform** — builds for macOS (`.dmg`, arm64 + x64) and Windows
  (NSIS installer) via GitHub Actions.

## Supported agents

| Agent | Launch | Resume | Install |
| --- | --- | --- | --- |
| Claude Code | `claude` | `claude --resume <id>` | `npm install -g @anthropic-ai/claude-code` |
| Codex | `codex` | `codex resume <id>` | `npm install -g @openai/codex` |
| Gemini CLI | `gemini` | `gemini --resume <id>` | `npm install -g @google/gemini-cli` |
| Plain terminal | shell only | — | — |

Adding a new agent is a few lines: implement the
[`AgentAdapter`](src/main/agents/registry.ts) interface (launch command, resume
command, transcript discovery) and register it.

## Installation

Prebuilt installers are attached to each
[GitHub Release](https://github.com/openxirp/openxirp/releases):

- **macOS** — download the `.dmg` (Apple Silicon and Intel builds available).
- **Windows** — download the NSIS `.exe` installer.

## Getting started

1. Add a project — point openxirp at any local folder. If it's a git repo,
   sessions will be isolated in worktrees.
2. Create a session — pick an agent (or a plain terminal). The session gets its
   own worktree, branch, and persistent terminal.
3. Let agents work in parallel — open as many sessions as you like; arrange them
   in tabs or a grid.
4. Resume prior work — open a project's History panel to browse past agent
   conversations and jump back in where you left off.

## Development

**Prerequisites:** Node 22+, git, and a C/C++ toolchain for the native
`node-pty` module (Xcode Command Line Tools on macOS, Build Tools for Visual
Studio on Windows).

```sh
git clone https://github.com/openxirp/openxirp.git
cd openxirp
npm install
npm run rebuild   # rebuild node-pty against Electron's ABI
npm run dev
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the app in development mode with HMR |
| `npm run build` | Compile main, preload, and renderer bundles |
| `npm run typecheck` | Type-check the node and web TypeScript projects |
| `npm run rebuild` | Rebuild native modules against Electron's ABI |
| `npm run pack:mac` | Produce macOS installers in `release/` |
| `npm run pack:win` | Produce Windows installers in `release/` |

Windows installers must be built on Windows and macOS installers on macOS —
CI handles both (see `.github/workflows/build.yml`).

## Architecture

```
Electron main (Node)                    Renderer (React + Vite)
  PtyManager     node-pty                 Sidebar: projects & sessions
  GitService     simple-git               Terminal grid / tabs (xterm.js)
  Store          atomic JSON              Zustand app state
  AgentRegistry  agent adapters           typed window.api client
         ^  contextBridge (preload)  v
```

- **Terminals in the main process** — PTYs outlive UI tabs; output is buffered
  and replayed on remount.
- **Typed IPC** — the renderer talks to the main process through a typed
  `window.api` client exposed via the preload `contextBridge`.
- **Atomic persistence** — projects and sessions are stored as JSON with atomic
  writes, so a crash never corrupts state.

## Roadmap

- [x] Git diff panel and file tree per session
- [x] Stage / unstage / commit from the changes panel
- [x] Command palette (Cmd/Ctrl + K)
- [x] Desktop notifications when a session needs attention or ends
- [x] Machine-wide command center for every agent session
- [x] Merge / open a PR / discard a session's worktree
- [x] Token / cost estimation per session and per project
- [ ] Run one task across several agents in parallel worktrees
- [ ] Rules and skills manager for agents
- [ ] External context integrations
- [ ] Linux builds

## Contributing

Contributions are welcome! Open an issue to discuss what you'd like to work on,
then submit a PR. Please run `npm run typecheck` before submitting.

## License

[MIT](LICENSE) © openxirp contributors
