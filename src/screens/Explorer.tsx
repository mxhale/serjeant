import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout, type Key } from 'ink'
import { configPath, ensureConfigFile, macros, resolveRepo, type Config } from '../config.js'
import { cacheGet, cacheSet, workAll, workGet, type Work } from '../db.js'
import { DEMO, fetchTickets, type Ticket } from '../linear.js'
import { toRows } from '../model.js'
import { claudeHandoff, startRun, subscribe, ui, type Handoff, type Screen } from '../store.js'
import { writeback } from '../writeback.js'
import { finishWork, renderPrompt, startWork } from '../work.js'
import { BADGE, Picker, eachKey } from '../widgets.js'

type Mode = 'normal' | 'filter' | 'command'
type Pick = { title: string; options: string[]; onSelect: (v: string) => void }

const STATE_COLOR: Record<string, string> = { started: 'yellow', unstarted: 'white', triage: 'magenta', backlog: 'gray', orphan: 'red' }
export const editor = () => process.env.SERJEANT_EDITOR ?? process.env.EDITOR ?? 'nvim'

// Worktrees whose ticket dropped out of the open-issues list (closed, reassigned): flag for :done.
const orphanTickets = (open: Ticket[], works: Work[]): Ticket[] =>
  works.filter(w => !open.some(t => t.key === w.key)).map(w => ({ ...w.ticket, state: 'Worktree left (ticket closed?)', stateType: 'orphan' }))

export function Explorer({ apiKey, demo, config, configError, go, handoff }: {
  apiKey?: string
  demo: boolean
  config: Config
  configError?: string
  go: (s: Screen) => void
  handoff: (h: Handoff) => void
}) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [tickets, setTickets] = useState<Ticket[]>(() => (demo ? DEMO : cacheGet<Ticket[]>(`tickets:${ui.scope}`) ?? []))
  const [status, setStatus] = useState(ui.status || configError || '')
  const [mode, setMode] = useState<Mode>('normal')
  const [buf, setBuf] = useState('')
  const [pick, setPick] = useState<Pick>()
  const [filter, setFilterS] = useState(ui.filter)
  const [team, setTeamS] = useState(ui.team)
  const [label, setLabelS] = useState(ui.label)
  const [cursor, setCursorS] = useState(ui.cursor)
  const pendingG = useRef(false)
  ui.status = ''
  useEffect(() => subscribe(bump), [])

  // Mirror view state into the store so it survives remounts after a handoff.
  const setFilter = (v: string) => { ui.filter = v; setFilterS(v) }
  const setTeam = (v?: string) => { ui.team = v; setTeamS(v) }
  const setLabel = (v?: string) => { ui.label = v; setLabelS(v) }
  const setCursor = (v: number) => { ui.cursor = v; setCursorS(v) }

  const works = workAll()
  const workByKey = new Map(works.map(w => [w.key, w]))
  const all = useMemo(() => [...tickets, ...orphanTickets(tickets, works)], [tickets, works.map(w => w.key).join()])
  const rows = useMemo(() => toRows(all, mode === 'filter' ? buf : filter, team, label), [all, mode, buf, filter, team, label])
  const list = useMemo(() => rows.flatMap(r => (r.type === 'ticket' ? [r.ticket] : [])), [rows])
  const cur = Math.min(cursor, Math.max(list.length - 1, 0))
  const selected = list[cur]
  const selWork = selected && workByKey.get(selected.key)

  const refresh = async (s = ui.scope) => {
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

  // ---- start work

  const begin = (t: Ticket, macroName: string, repoName: string) => {
    try {
      const w = startWork(config, t, macroName, repoName)
      void writeback(config, apiKey, t.key, 'start').then(m => m && setStatus(`Linear → ${m}`), e => setStatus(`writeback: ${e.message}`))
      const macro = macros(config)[macroName]
      const prompt = renderPrompt(macro.prompt, t, w.branch)
      if (macro.mode === 'headless') { startRun(w, macro, prompt); go({ name: 'run', key: t.key }) }
      else handoff(claudeHandoff(w, macro, prompt))
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const start = (t: Ticket) => {
    if (workByKey.has(t.key)) return go({ name: 'run', key: t.key })
    const ms = macros(config)
    const dflt = config.teams[t.team]?.default_macro
    const names = Object.keys(ms).sort((a, b) => Number(b === dflt) - Number(a === dflt))
    const chooseRepo = (macroName: string) => {
      const known = resolveRepo(config, t)?.name
      const repos = Object.keys(config.repos)
      if (known) return begin(t, macroName, known)
      if (repos.length === 0) return setStatus('no repos configured: :config, then add one under [repos]')
      if (repos.length === 1) return begin(t, macroName, repos[0])
      setPick({ title: `Repo for ${t.key}`, options: repos, onSelect: r => { setPick(undefined); begin(t, macroName, r) } })
    }
    setPick({
      title: `Start ${t.key} with…`,
      options: names.map(n => `${n} (${ms[n].mode})`),
      onSelect: v => { setPick(undefined); chooseRepo(v.split(' ')[0]) },
    })
  }

  const openWith = (what: 'nvim' | 'claude') => {
    if (!selWork) return setStatus('no worktree yet: s to start work')
    if (what === 'nvim') handoff({ cmd: editor(), args: [], cwd: selWork.path })
    else handoff(claudeHandoff(selWork, macros(config)[selWork.macro] ?? macros(config).implement))
  }

  // ---- commands

  const run = (cmd: string) => {
    const [name, arg] = cmd.trim().split(/\s+/)
    const switchScope = (s: 'mine' | 'all') => {
      ui.scope = s
      setTickets(cacheGet<Ticket[]>(`tickets:${s}`) ?? [])
      void refresh(s)
    }
    if (name === 'q' || name === 'quit') exit()
    else if (name === 'all') switchScope('all')
    else if (name === 'mine') switchScope('mine')
    else if (name === 'team') setTeam(arg?.toUpperCase())
    else if (name === 'label') setLabel(arg)
    else if (name === 'clear') { setTeam(undefined); setLabel(undefined); setFilter('') }
    else if (name === 'config' || name === 'macro') {
      ensureConfigFile()
      handoff({ cmd: editor(), args: [configPath()], cwd: process.cwd() })
    } else if (name === 'done' || name === 'done!') {
      const key = arg ?? selected?.key
      if (!key) return setStatus('done: which ticket?')
      try { finishWork(config, key, name === 'done!'); setStatus(`${key}: worktree removed`) }
      catch (e) { setStatus(`${key}: ${(e as Error).message}`) }
    } else setStatus(`unknown command: ${name}`)
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
    else if ((input === 's' || key.return) && selected) start(selected)
    else if (input === 'e') openWith('nvim')
    else if (input === 'c') openWith('claude')
    else if (input === 'R' && selWork) go({ name: 'review', key: selWork.key })
    else if (key.escape) { setFilter(''); setTeam(undefined); setLabel(undefined) }
    else if (input === 'q') exit()
  }
  useInput((input, key) => {
    if (pick) return
    if (mode === 'normal') eachKey(input, key, c => handle(c, key))
    else handle(input, key)
  })

  // Scroll window: keep the cursor row in view.
  const cursorRow = rows.findIndex(r => r.type === 'ticket' && r.ticket === selected)
  const top = Math.max(0, Math.min(cursorRow - Math.floor(height / 2), rows.length - height))
  const visible = rows.slice(top, top + height)
  const listW = Math.min(Math.max(Math.floor((stdout.columns || 100) * 0.42), 34), 62)

  const scopeLabel = [ui.scope === 'mine' ? 'Assigned' : 'All', team, label && `#${label}`, filter && `/${filter}`].filter(Boolean).join(' · ')

  return (
    <Box flexDirection="column" height={stdout.rows || 24}>
      <Box flexGrow={1}>
        <Box width={listW} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Text bold color="cyan">{scopeLabel}</Text>
          {visible.length === 0 && <Text dimColor>no issues</Text>}
          {visible.map(r => {
            if (r.type === 'header') return <Text key={'h' + r.label} bold dimColor>{r.label}</Text>
            const w = workByKey.get(r.ticket.key)
            const [g, c] = w ? (r.ticket.stateType === 'orphan' ? ['⚑', 'red'] : BADGE[w.runState]) : [' ', 'white']
            return (
              <Text key={r.ticket.key} wrap="truncate" inverse={r.ticket === selected}>
                <Text color={c}>{g}</Text> {r.ticket.key.padEnd(8)}{r.ticket.title}
              </Text>
            )
          })}
        </Box>
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {pick ? (
            <Picker title={pick.title} options={pick.options} onSelect={pick.onSelect} onCancel={() => setPick(undefined)} />
          ) : selected ? (
            <Detail t={selected} w={selWork} />
          ) : (
            <Text dimColor>nothing selected</Text>
          )}
        </Box>
      </Box>
      <Box paddingX={1}>
        {mode === 'normal' ? (
          <Text dimColor wrap="truncate">{status || 'j/k gg G  / filter  : cmd  s start  e nvim  c claude  R review  r refresh  q quit'}</Text>
        ) : (
          <Text>{mode === 'filter' ? '/' : ':'}{buf}<Text inverse> </Text></Text>
        )}
      </Box>
    </Box>
  )
}

function Detail({ t, w }: { t: Ticket; w?: Work }) {
  return (
    <>
      <Text bold>{t.key} · {t.title}</Text>
      <Text color={STATE_COLOR[t.stateType] ?? 'white'}>{t.state}
        <Text dimColor>  {t.team}{t.assignee ? `  @${t.assignee}` : ''}</Text>
      </Text>
      {t.labels.length > 0 && <Text color="blue">{t.labels.map(l => `#${l}`).join(' ')}</Text>}
      <Text dimColor>{t.branch}</Text>
      {w && <Text color={BADGE[w.runState][1]}>{BADGE[w.runState][0]} {w.runState} · {w.macro} · {w.path}</Text>}
      <Text> </Text>
      <Text>{t.body || '(no description)'}</Text>
    </>
  )
}
