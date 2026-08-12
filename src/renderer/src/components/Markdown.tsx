import type { ReactNode } from 'react'

/*
 * A small, dependency-free markdown renderer that builds React nodes directly
 * (no dangerouslySetInnerHTML, so agent text can never inject markup). It covers
 * what coding-agent transcripts actually use: fenced code, inline code, bold,
 * italic, headings, lists, blockquotes, and links rendered as plain styled text.
 */

interface Rule {
  name: 'code' | 'bold' | 'italic' | 'strike' | 'link'
  re: RegExp
}

const INLINE_RULES: Rule[] = [
  { name: 'code', re: /`([^`]+)`/ },
  { name: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { name: 'bold', re: /__([\s\S]+?)__/ },
  { name: 'strike', re: /~~([\s\S]+?)~~/ },
  { name: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { name: 'italic', re: /\*([^*\n]+?)\*/ },
  { name: 'italic', re: /_([^_\n]+?)_/ }
]

function inline(text: string, key: string): ReactNode[] {
  let best: { rule: Rule; m: RegExpExecArray } | null = null
  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(text)
    if (m && (best === null || m.index < best.m.index)) best = { rule, m }
  }
  if (!best) return [text]

  const { rule, m } = best
  const before = text.slice(0, m.index)
  const after = text.slice(m.index + m[0].length)
  const k = `${key}:${m.index}`
  const nodes: ReactNode[] = []
  if (before) nodes.push(before)

  switch (rule.name) {
    case 'code':
      nodes.push(
        <code className="md-ic" key={k}>
          {m[1]}
        </code>
      )
      break
    case 'bold':
      nodes.push(<strong key={k}>{inline(m[1], k)}</strong>)
      break
    case 'italic':
      nodes.push(<em key={k}>{inline(m[1], k)}</em>)
      break
    case 'strike':
      nodes.push(
        <span className="md-strike" key={k}>
          {inline(m[1], k)}
        </span>
      )
      break
    case 'link':
      nodes.push(
        <span className="md-link" key={k} title={m[2]}>
          {m[1]}
        </span>
      )
      break
  }

  nodes.push(...inline(after, `${key}>`))
  return nodes
}

type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'p'; text: string }

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // fenced code
    const fence = line.match(/^```(.*)$/)
    if (fence) {
      const lang = fence[1].trim()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // consume closing fence
      blocks.push({ type: 'code', lang, code: body.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // paragraph: gather until a blank line or a block starter
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', text: para.join('\n') })
  }

  return blocks
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = parseBlocks(text)
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'code':
            return (
              <pre className="md-code" key={i}>
                {b.lang && <span className="md-code__lang">{b.lang}</span>}
                <code>{b.code}</code>
              </pre>
            )
          case 'heading':
            return (
              <div className="md-h" data-level={b.level} key={i} role="heading" aria-level={b.level}>
                {inline(b.text, `h${i}`)}
              </div>
            )
          case 'ul':
            return (
              <ul className="md-ul" key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `ul${i}-${j}`)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol className="md-ol" key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `ol${i}-${j}`)}</li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote className="md-quote" key={i}>
                {inline(b.text, `q${i}`)}
              </blockquote>
            )
          default:
            return (
              <p className="md-p" key={i}>
                {inline(b.text, `p${i}`)}
              </p>
            )
        }
      })}
    </div>
  )
}

/** Flatten markdown to a single clean line, for titles and one-line summaries. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/\*\*|__/g, '') // dangling emphasis from a truncated string
    .replace(/\s+/g, ' ')
    .trim()
}
