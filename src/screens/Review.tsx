import { useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout, type Key } from 'ink'
import { macros, type Config } from '../config.js'
import { commentAdd, commentDel, commentsList, commentsMarkSent, viewedList, viewedToggle, workGet } from '../db.js'
import { approve, diffFor, formatReview, type DLine } from '../review.js'
import { sendToRun } from '../store.js'
import { eachKey } from '../widgets.js'

type Row = { kind: 'hunk'; text: string } | { kind: 'line'; line: DLine } | { kind: 'note'; text: string }
type Mode = 'normal' | 'comment' | 'confirm'

const anchor = (l: DLine) => ({ side: (l.kind === 'del' ? 'old' : 'new') as 'old' | 'new', no: (l.newNo ?? l.oldNo)! })

export function Review({ wkey, config, apiKey, back, toRun }: {
  wkey: string
  config: Config
  apiKey?: string
  back: () => void
  toRun: () => void
}) {
  const { stdout } = useStdout()
  const [rev, bump] = useReducer((n: number) => n + 1, 0)
  const [fileIdx, setFileIdx] = useState(0)
  const [cursor, setCursorS] = useState(0)
  const cursorRef = useRef(0) // batched keys ("jjj") must each see the previous key's result
  const setCursor = (v: number) => { cursorRef.current = v; setCursorS(v) }
  const [visual, setVisual] = useState<number>()
  const [mode, setMode] = useState<Mode>('normal')
  const [buf, setBuf] = useState('')
  const [status, setStatus] = useState('')
  const pendingG = useRef(false)

  const work = workGet(wkey)!
  const files = useMemo(() => (work ? diffFor(work.path) : []), [rev])
  const file = files[Math.min(fileIdx, files.length - 1)]
  const comments = commentsList(wkey)
  const viewed = viewedList(wkey)

  const rows: Row[] = useMemo(
    () => !file ? [] : file.binary || file.hunks.length === 0
      ? [{ kind: 'note', text: file.binary ? '(binary file)' : '(no textual changes)' }]
      : file.hunks.flatMap(h => [{ kind: 'hunk' as const, text: h.header }, ...h.lines.map(line => ({ kind: 'line' as const, line }))]),
    [file],
  )
  const cur = Math.min(cursor, Math.max(rows.length - 1, 0))
  cursorRef.current = cur
  const here = rows[cur]
  const commentsAt = (r: Row) => {
    if (!file || r.kind !== 'line') return []
    const a = anchor(r.line)
    return comments.filter(c => c.file === file.path && c.side === a.side && c.endLine === a.no)
  }

  // Interleave inline comments under their lines, then window around the cursor.
  const display = rows.flatMap((r, i) => [{ row: r, i, comment: undefined as undefined | (typeof comments)[number] }, ...commentsAt(r).map(c => ({ row: r, i, comment: c }))])
  const height = Math.max((stdout.rows || 24) - 4, 5)
  const curDisplay = display.findIndex(d => d.i === cur && !d.comment)
  const top = Math.max(0, Math.min(curDisplay - Math.floor(height / 2), display.length - height))
  const visible = display.slice(top, top + height)
  const selRange = visual === undefined ? [cur, cur] : [Math.min(visual, cur), Math.max(visual, cur)]
  const unsent = comments.filter(c => !c.sent)

  const goFile = (n: number) => { setFileIdx(Math.max(0, Math.min(files.length - 1, n))); setCursor(0); setVisual(undefined) }
  const hunkAt = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (rows[i].kind === 'hunk') return i
    return from
  }

  const addComment = () => {
    const picked = rows.slice(selRange[0], selRange[1] + 1).flatMap(r => (r.kind === 'line' ? [r.line] : []))
    if (!file || picked.length === 0 || !buf.trim()) return
    const a = anchor(picked[0])
    const b = anchor(picked[picked.length - 1])
    commentAdd({
      key: wkey, file: file.path, line: a.no, endLine: b.no, side: a.side,
      code: picked.slice(0, 8).map(l => l.text).join('\n'), text: buf.trim(),
    })
  }

  const send = () => {
    if (unsent.length === 0) return setStatus('no unsent comments')
    sendToRun(work, macros(config)[work.macro] ?? macros(config).implement, formatReview(wkey, unsent))
    commentsMarkSent(wkey)
    toRun()
  }

  const ship = async () => {
    setStatus('pushing and opening PR…')
    try { setStatus(`PR: ${await approve({ config, apiKey, work })}`) }
    catch (e) { setStatus(`approve: ${(e as Error).message.split('\n')[0]}`) }
  }

  const handle = (c: string, key: Key) => {
    if (mode === 'comment') {
      if (key.escape) { setMode('normal'); setBuf('') }
      else if (key.return) { addComment(); setMode('normal'); setBuf(''); setVisual(undefined); bump() }
      else if (key.backspace || key.delete) setBuf(b => b.slice(0, -1))
      else if (c && !key.ctrl && !key.meta) setBuf(b => b + c)
      return
    }
    if (mode === 'confirm') {
      setMode('normal')
      if (c === 'y') void ship()
      else setStatus('')
      return
    }
    const wasG = pendingG.current
    pendingG.current = false
    const move = (n: number) => setCursor(Math.max(0, Math.min(rows.length - 1, cursorRef.current + n)))
    if (c === 'j' || key.downArrow) move(1)
    else if (c === 'k' || key.upArrow) move(-1)
    else if (c === 'g') { if (wasG) setCursor(0); else pendingG.current = true }
    else if (c === 'G') setCursor(Math.max(rows.length - 1, 0))
    else if (key.ctrl && c === 'd') move(Math.floor(height / 2))
    else if (key.ctrl && c === 'u') move(-Math.floor(height / 2))
    else if (c === ']') setCursor(hunkAt(cursorRef.current, 1))
    else if (c === '[') setCursor(hunkAt(cursorRef.current, -1))
    else if (c === 'n') goFile(fileIdx + 1)
    else if (c === 'N') goFile(fileIdx - 1)
    else if (c === 'm' && file) { viewedToggle(wkey, file.path); bump() }
    else if (c === 'V') setVisual(v => (v === undefined ? cur : undefined))
    else if (c === 'c' && here?.kind === 'line') setMode('comment')
    else if (c === 'x') { const hit = commentsAt(here)[0]; if (hit) { commentDel(hit.id); bump() } }
    else if (c === 'Z') send()
    else if (c === 'a') { setMode('confirm'); setStatus('approve: push branch and open PR? y/n') }
    else if (c === 'r') { bump(); setStatus('refreshed') }
    else if (c === 'q' || key.escape) { if (visual !== undefined) setVisual(undefined); else back() }
  }
  useInput((input, key) => {
    if (mode === 'normal') eachKey(input, key, c => handle(c, key))
    else handle(input, key)
  })

  const listW = Math.min(Math.max(Math.floor((stdout.columns || 100) * 0.28), 22), 40)
  return (
    <Box flexDirection="column" height={stdout.rows || 24}>
      <Box paddingX={1}>
        <Text bold>{wkey} review</Text>
        <Text dimColor>  {files.length} files · {viewed.size} viewed · {comments.length} comments ({unsent.length} unsent)</Text>
      </Box>
      <Box flexGrow={1}>
        <Box width={listW} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {files.length === 0 && <Text dimColor>no changes</Text>}
          {files.map((f, i) => {
            const n = comments.filter(c => c.file === f.path).length
            return (
              <Text key={f.path} wrap="truncate-start" inverse={i === fileIdx}>
                {viewed.has(f.path) ? '✓' : ' '}{f.status} {f.path}{n ? ` (${n})` : ''}
              </Text>
            )
          })}
        </Box>
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {visible.map((d, n) => {
            if (d.comment) return <Text key={'c' + d.comment.id} color="yellow" wrap="truncate">{'     ┊ 💬 '}{d.comment.text}{d.comment.sent ? ' (sent)' : ''}</Text>
            const r = d.row
            const sel = d.i >= selRange[0] && d.i <= selRange[1]
            if (r.kind === 'hunk') return <Text key={'h' + n} color="cyan" dimColor wrap="truncate" inverse={sel && d.i === cur}>{r.text}</Text>
            if (r.kind === 'note') return <Text key={'n' + n} dimColor>{r.text}</Text>
            const l = r.line
            const mark = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '
            const no = String(l.newNo ?? l.oldNo).padStart(4)
            return (
              <Text key={'l' + n + d.i} wrap="truncate" inverse={sel} color={l.kind === 'add' ? 'green' : l.kind === 'del' ? 'red' : undefined}>
                {no} {mark} {l.text || ' '}
              </Text>
            )
          })}
        </Box>
      </Box>
      <Box paddingX={1}>
        {mode === 'comment' ? (
          <Text color="yellow">comment: {buf}<Text inverse> </Text></Text>
        ) : (
          <Text dimColor wrap="truncate">{status || 'j/k ]/[ hunk  n/N file  m viewed  c comment  V range  x delete  Z send  a approve  q back'}</Text>
        )}
      </Box>
    </Box>
  )
}
