import { useEffect, useState } from 'react'
import type { SessionUsage } from '@shared/types'

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export function formatCost(usd: number | null): string | null {
  if (usd === null) return null
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** A compact token/cost summary for a single usage record. */
export function UsageSummary({ usage }: { usage: SessionUsage }): JSX.Element {
  const cost = formatCost(usage.costUsd)
  const cached = usage.cacheReadTokens + usage.cacheCreateTokens
  const title =
    `Estimated from transcript token counts` +
    (cached > 0 ? ` · ${formatTokens(cached)} cached tokens (billed in cost)` : '')
  return (
    <span className="usage" title={title}>
      <span className="usage__io">
        {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
      </span>
      {cost && <span className="usage__cost">{cost}</span>}
    </span>
  )
}

/** Lazily reads and renders per-session usage; renders nothing when unavailable. */
export function SessionUsageChip({
  agentId,
  cwd,
  sessionId
}: {
  agentId: string
  cwd: string
  sessionId: string
}): JSX.Element | null {
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  useEffect(() => {
    let alive = true
    setUsage(null)
    void window.api.sessionUsage(agentId, cwd, sessionId).then((u) => {
      if (alive) setUsage(u)
    })
    return () => {
      alive = false
    }
  }, [agentId, cwd, sessionId])

  if (!usage || usage.inputTokens + usage.outputTokens === 0) return null
  return <UsageSummary usage={usage} />
}
