import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { macros, type Config } from '../config.js'
import { workGet } from '../db.js'
import type { Item } from '../run.js'
import { answerRun, getView, isLive, sendToRun, subscribe } from '../store.js'
import { BADGE, eachKey, wrapText } from '../widgets.js'

type Line = { text: string; color?: string; dim?: boolean }

export function toLines(items: Item[], width: number): Line[] {
  const out: Line[] = []
  for (const it of items) {
    if (it.kind === 'text') wrapText(it.text, width).forEach(text => out.push({ text }))
    else if (it.kind === 'user') {
      const w = wrapText(`> ${it.text}`, width)
      w.slice(0, 3).forEach(text => out.push({ text, color: 'green' }))
      if (w.length > 3) out.push({ text: `  … ${w.length - 3} more lines`, dim: true })
    }
    else if (it.kind === 'tool') out.push({ text: `⚙ ${it.name} ${it.summary}`.slice(0, width), color: 'cyan' })
    else if (it.kind === 'result') out.push({ text: `  ↳ ${it.text}`.slice(0, width), dim: true })
    else out.push({ text: it.text, color: 'red' })
    if (it.kind === 'text' || it.kind === 'user') out.push({ text: '' })
  }
  return out
}

export function RunView({ wkey, config, back, review, handoff }: {
  wkey: string
  config: Config
  back: () => void
  review: () => void
  handoff: (what: 'nvim' | 'claude') => void
}) {
  const { stdout } = useStdout()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [typing, setTyping] = useState(false)
  const [buf, setBuf] = useState('')
  const [scroll, setScrollS] = useState(0) // lines above the bottom; 0 follows the stream
  const scrollRef = useRef(0)
  const setScroll = (v: number) => { scrollRef.current = v; setScrollS(v) }
  const pendingG = useRef(false)
  useEffect(() => subscribe(bump), [])

  const work = workGet(wkey)
  const view = getView(wkey)
  const width = Math.max((stdout.columns || 100) - 4, 20)
  const height = Math.max((stdout.rows || 24) - 6, 5)
  const lines = useMemo(() => toLines(view.items, width), [view.items, width])
  const maxScroll = Math.max(lines.length - height, 0)
  const s = Math.min(scroll, maxScroll)
  scrollRef.current = s
  const shown = lines.slice(Math.max(lines.length - height - s, 0), lines.length - s)
  const [glyph, color] = BADGE[view.state]
  const live = isLive(wkey)

  const handle = (c: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    if (typing) {
      if (key.escape) { setTyping(false); setBuf('') }
      else if (key.return) {
        if (buf.trim() && work) sendToRun(work, macros(config)[work.macro] ?? macros(config).implement, buf.trim())
        setTyping(false); setBuf(''); setScroll(0)
      } else if (key.backspace || key.delete) setBuf(b => b.slice(0, -1))
      else if (c && !key.ctrl && !key.meta) setBuf(b => b + c)
      return
    }
    const wasG = pendingG.current
    pendingG.current = false
    if (view.pending && c === 'a') answerRun(wkey, true)
    else if (view.pending && c === 'x') answerRun(wkey, false)
    else if (c === 'i' || c === 'r') setTyping(true)
    else if (c === 'j' || key.downArrow) setScroll(Math.max(scrollRef.current - 1, 0))
    else if (c === 'k' || key.upArrow) setScroll(Math.min(scrollRef.current + 1, maxScroll))
    else if (key.ctrl && c === 'd') setScroll(Math.max(s - Math.floor(height / 2), 0))
    else if (key.ctrl && c === 'u') setScroll(Math.min(s + Math.floor(height / 2), maxScroll))
    else if (c === 'G') setScroll(0)
    else if (c === 'g') { if (wasG) setScroll(maxScroll); else pendingG.current = true }
    else if (c === 'e') handoff('nvim')
    else if (c === 'c') handoff('claude')
    else if (c === 'R') review()
    else if (c === 'q' || key.escape) back()
  }
  useInput((input, key) => {
    if (typing) handle(input, key)
    else eachKey(input, key, c => handle(c, key))
  })

  return (
    <Box flexDirection="column" height={stdout.rows || 24}>
      <Box paddingX={1}>
        <Text bold>{wkey}</Text>
        <Text> {work?.ticket.title}  </Text>
        <Text color={color}>{glyph} {view.state}{live ? '' : view.state === 'idle' ? '' : ' (not running)'}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {shown.length === 0 && <Text dimColor>{view.state === 'idle' ? 'no run yet' : 'waiting for output…'}</Text>}
        {shown.map((l, i) => <Text key={i} color={l.color} dimColor={l.dim}>{l.text || ' '}</Text>)}
      </Box>
      {view.pending && (
        <Box paddingX={1} borderStyle="round" borderColor="red">
          <Text color="red" bold>Allow {view.pending.tool}? </Text>
          <Text wrap="truncate">{view.pending.summary}  </Text>
          <Text dimColor>[a]llow [x]deny</Text>
        </Box>
      )}
      <Box paddingX={1}>
        {typing ? (
          <Text color="green">&gt; {buf}<Text inverse> </Text></Text>
        ) : (
          <Text dimColor>
            {view.state === 'asking' ? 'agent asked a question · ' : ''}i reply  j/k gg G scroll  e nvim  c claude  R review  q back
          </Text>
        )}
      </Box>
    </Box>
  )
}
