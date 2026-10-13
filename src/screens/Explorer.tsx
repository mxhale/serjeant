import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout, type Key } from 'ink'
import { cacheGet, cacheSet } from '../db.js'
import { DEMO, fetchTickets, type Ticket } from '../linear.js'
import { toRows } from '../model.js'

type Mode = 'normal' | 'filter' | 'command'
type Scope = 'mine' | 'all'

const STATE_COLOR: Record<string, string> = { started: 'yellow', unstarted: 'white', triage: 'magenta', backlog: 'gray' }

export function Explorer({ apiKey, demo }: { apiKey?: string; demo: boolean }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [scope, setScope] = useState<Scope>('mine')
  const [tickets, setTickets] = useState<Ticket[]>(() => (demo ? DEMO : cacheGet<Ticket[]>('tickets:mine') ?? []))
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState<Mode>('normal')
  const [buf, setBuf] = useState('')
  const [filter, setFilter] = useState('')
  const [team, setTeam] = useState<string>()
  const [label, setLabel] = useState<string>()
  const [cursor, setCursor] = useState(0)
  const pendingG = useRef(false)

  const rows = useMemo(() => toRows(tickets, mode === 'filter' ? buf : filter, team, label), [tickets, mode, buf, filter, team, label])
  const list = useMemo(() => rows.flatMap(r => (r.type === 'ticket' ? [r.ticket] : [])), [rows])
  const cur = Math.min(cursor, Math.max(list.length - 1, 0))
  const selected = list[cur]

  const refresh = async (s: Scope = scope) => {
    if (demo) return setStatus('demo data')
    if (!apiKey) return setStatus('set LINEAR_API_KEY (or run with --demo)')
    setStatus('refreshing…')
    try {
      const fresh = await fetchTickets(apiKey, s)
      cacheSet(`tickets:${s}`, fresh)
      setTickets(fresh)
      setStatus(`${fresh.length} issues · ${new Date().toLocaleTimeString()}`)
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`)
    }
  }
  useEffect(() => { void refresh() }, [])

  const run = (cmd: string) => {
    const [name, arg] = cmd.trim().split(/\s+/)
    const switchScope = (s: Scope) => {
      setScope(s)
      setTickets(cacheGet<Ticket[]>(`tickets:${s}`) ?? [])
      void refresh(s)
    }
    if (name === 'q' || name === 'quit') exit()
    else if (name === 'all') switchScope('all')
    else if (name === 'mine') switchScope('mine')
    else if (name === 'team') setTeam(arg?.toUpperCase())
    else if (name === 'label') setLabel(arg)
    else if (name === 'clear') { setTeam(undefined); setLabel(undefined); setFilter('') }
    else setStatus(`unknown command: ${name}`)
    setCursor(0)
  }

  const height = Math.max((stdout.rows || 24) - 3, 5)
  const handle = (input: string, key: Key) => {
    if (mode !== 'normal') {
      if (key.escape) { setMode('normal'); setBuf('') }
      else if (key.return) {
        if (mode === 'filter') setFilter(buf)
        else run(buf)
        setMode('normal'); setBuf(''); setCursor(0)
      } else if (key.backspace || key.delete) setBuf(b => b.slice(0, -1))
      else if (input && !key.ctrl && !key.meta) setBuf(b => b + input)
      return
    }
    const last = list.length - 1
    const move = (n: number) => setCursor(Math.max(0, Math.min(last, cur + n)))
    const wasG = pendingG.current
    pendingG.current = false
    if (input === 'j' || key.downArrow) move(1)
    else if (input === 'k' || key.upArrow) move(-1)
    else if (input === 'g') { if (wasG) setCursor(0); else pendingG.current = true }
    else if (input === 'G') setCursor(Math.max(last, 0))
    else if (key.ctrl && input === 'd') move(Math.floor(height / 2))
    else if (key.ctrl && input === 'u') move(-Math.floor(height / 2))
    else if (input === '/') { setMode('filter'); setBuf(filter) }
    else if (input === ':') setMode('command')
    else if (input === 'r') void refresh()
    else if (key.escape) { setFilter(''); setTeam(undefined); setLabel(undefined) }
    else if (input === 'q') exit()
  }
  // Fast typing / key repeat / paste arrive as one string; replay normal-mode keys one by one.
  useInput((input, key) => {
    if (mode === 'normal' && input.length > 1 && !key.ctrl && !key.meta) for (const c of input) handle(c, key)
    else handle(input, key)
  })

  // Scroll window: keep the cursor row in view.
  const cursorRow = rows.findIndex(r => r.type === 'ticket' && r.ticket === selected)
  const top = Math.max(0, Math.min(cursorRow - Math.floor(height / 2), rows.length - height))
  const visible = rows.slice(top, top + height)
  const listW = Math.min(Math.max(Math.floor((stdout.columns || 100) * 0.42), 32), 60)

  const scopeLabel = [scope === 'mine' ? 'Assigned' : 'All', team, label && `#${label}`, filter && `/${filter}`].filter(Boolean).join(' · ')

  return (
    <Box flexDirection="column" height={stdout.rows || 24}>
      <Box flexGrow={1}>
        <Box width={listW} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Text bold color="cyan">{scopeLabel}</Text>
          {visible.length === 0 && <Text dimColor>no issues</Text>}
          {visible.map(r =>
            r.type === 'header' ? (
              <Text key={'h' + r.label} bold dimColor>{r.label}</Text>
            ) : (
              <Text key={r.ticket.key} wrap="truncate" inverse={r.ticket === selected}>
                {r.ticket.key.padEnd(8)}{r.ticket.title}
              </Text>
            ),
          )}
        </Box>
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {selected ? <Detail t={selected} /> : <Text dimColor>nothing selected</Text>}
        </Box>
      </Box>
      <Box paddingX={1}>
        {mode === 'normal' ? (
          <Text dimColor>{status || 'j/k gg G  / filter  : cmd  r refresh  q quit'}</Text>
        ) : (
          <Text>{mode === 'filter' ? '/' : ':'}{buf}<Text inverse> </Text></Text>
        )}
      </Box>
    </Box>
  )
}

function Detail({ t }: { t: Ticket }) {
  return (
    <>
      <Text bold>{t.key} · {t.title}</Text>
      <Text color={STATE_COLOR[t.stateType] ?? 'white'}>{t.state}
        <Text dimColor>  {t.team}{t.assignee ? `  @${t.assignee}` : ''}</Text>
      </Text>
      {t.labels.length > 0 && <Text color="blue">{t.labels.map(l => `#${l}`).join(' ')}</Text>}
      <Text dimColor>{t.branch}</Text>
      <Text> </Text>
      <Text>{t.body || '(no description)'}</Text>
    </>
  )
}
