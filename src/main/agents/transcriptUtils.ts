import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import type { TranscriptMessage } from '@shared/types'

/** Caps so a huge transcript can never blow up the preview. */
export const MAX_MESSAGES = 600
export const MAX_TEXT = 6000

export function clampText(s: string): string {
  const t = s.replace(/\r/g, '').trim()
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n…' : t
}

/** A human prompt, as opposed to a tool result or injected system block. */
export function isHumanPrompt(text: string | null | undefined): text is string {
  if (!text) return false
  const t = text.trim()
  return t.length > 0 && !t.startsWith('<') && !t.startsWith('[')
}

/** Keep only the last MAX_MESSAGES so previews stay bounded. */
export function tail(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages
}

/** Stream a .jsonl file line by line, parsing each line as JSON (bad lines skipped). */
export async function forEachJsonl(
  file: string,
  onLine: (obj: Record<string, unknown>) => void
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })
  try {
    for await (const line of rl) {
      if (!line) continue
      try {
        onLine(JSON.parse(line))
      } catch {
        /* skip malformed line */
      }
    }
  } finally {
    rl.close()
  }
}
