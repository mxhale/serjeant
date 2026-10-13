// Module-level state that must outlive React mounts: serjeant remounts the UI after every
// handoff to nvim/claude, while headless runs keep going in the background.
import { randomUUID } from 'node:crypto'
import { workMarkInterrupted, workPatch, type Work } from './db.js'
import type { Macro } from './config.js'
import { emptyView, handoffArgs, headlessArgs, replayLog, Run, type View } from './run.js'

export type Screen = { name: 'explorer' } | { name: 'run'; key: string } | { name: 'review'; key: string }
export type Handoff = { cmd: string; args: string[]; cwd: string }

export const ui = {
  screen: { name: 'explorer' } as Screen,
  scope: 'mine' as 'mine' | 'all',
  filter: '',
  team: undefined as string | undefined,
  label: undefined as string | undefined,
  cursor: 0,
  handoff: undefined as Handoff | undefined,
  status: '',
}

const runs = new Map<string, Run>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

workMarkInterrupted() // anything "live" in the db belonged to a previous process

function track(w: Work): Run {
  const run = new Run(w.key, () => {
    if (runs.get(w.key) !== run) return // a replaced run's late exit must not clobber the new one
    workPatch(w.key, { runState: run.view.state })
    notify()
  })
  runs.set(w.key, run)
  return run
}

const sessionOf = (w: Work) => {
  const fresh = !w.sessionId
  const sessionId = w.sessionId ?? randomUUID()
  if (fresh) workPatch(w.key, { sessionId })
  return { sessionId, resume: !fresh }
}

export const isLive = (key: string) => !!runs.get(key)?.alive

export function getView(key: string): View {
  return runs.get(key)?.view ?? replayLog(key) ?? emptyView()
}

export function startRun(w: Work, macro: Macro, prompt: string) {
  runs.get(w.key)?.kill()
  const { sessionId, resume } = sessionOf(w)
  track(w).start(w.path, headlessArgs(macro.flags, sessionId, resume), prompt, sessionId)
  notify()
}

// Message the ticket's agent: straight to the live process, else resume the session with it.
export function sendToRun(w: Work, macro: Macro, text: string) {
  const live = runs.get(w.key)
  if (live?.alive) return live.send(text)
  startRun(w, macro, text)
}

export const answerRun = (key: string, allow: boolean) => runs.get(key)?.answer(allow)

export function claudeHandoff(w: Work, macro: Macro, prompt?: string): Handoff {
  runs.get(w.key)?.kill() // two claudes on one session would fight
  const { sessionId, resume } = sessionOf(w)
  return { cmd: process.env.SERJEANT_CLAUDE ?? 'claude', args: handoffArgs(macro.flags, sessionId, resume, resume ? undefined : prompt), cwd: w.path }
}

export const killRun = (key: string) => runs.get(key)?.kill()

export const killAll = () => runs.forEach(r => r.kill())
