import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Session } from '@shared/types'

/** Light editorial terminal theme, tuned for readable ANSI on paper. */
const THEME = {
  background: '#ffffff',
  foreground: '#2a2822',
  cursor: '#e0323f',
  cursorAccent: '#ffffff',
  selectionBackground: '#f6d9dc',
  selectionForeground: '#17150f',
  black: '#3a3730',
  red: '#c31f2c',
  green: '#1f8a54',
  yellow: '#9a6a12',
  blue: '#2f6f9f',
  magenta: '#8f2fae',
  cyan: '#0f7f88',
  white: '#d7d2c7',
  brightBlack: '#8b877d',
  brightRed: '#e0323f',
  brightGreen: '#2fae6b',
  brightYellow: '#b7791f',
  brightBlue: '#4a8fc0',
  brightMagenta: '#b45fd0',
  brightCyan: '#2fb0b0',
  brightWhite: '#17150f'
}

interface Props {
  session: Session
  visible: boolean
}

export function TerminalView({ session, visible }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily:
        "'SF Mono', 'JetBrains Mono', 'Cascadia Code', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: THEME,
      scrollback: 10_000,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const id = session.id
    let disposed = false

    const doFit = (): void => {
      try {
        fit.fit()
        window.api.ptyResize(id, term.cols, term.rows)
      } catch {
        /* host not measurable yet */
      }
    }

    window.api.ptyStart(id).then((res) => {
      if (disposed) return
      if (res.backlog) term.write(res.backlog)
      doFit()
    })

    term.onData((data) => window.api.ptyInput(id, data))

    const offData = window.api.onPtyData((e) => {
      if (e.id === id) term.write(e.data)
    })
    const offExit = window.api.onPtyExit((e) => {
      if (e.id === id) term.write(`\r\n\x1b[38;5;244m[session ended, exit ${e.exitCode}]\x1b[0m\r\n`)
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(host)

    return () => {
      disposed = true
      offData()
      offExit()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Refit when this pane becomes visible (tab switch reveals a 0-sized host).
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) window.api.ptyResize(session.id, term.cols, term.rows)
        term?.focus()
      } catch {
        /* ignore */
      }
    }, 30)
    return () => clearTimeout(t)
  }, [visible, session.id])

  return <div className="pane__term" ref={hostRef} />
}
