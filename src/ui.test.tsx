import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'ink-testing-library'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaults } from './config.js'
import { workPut } from './db.js'
import { DEMO } from './linear.js'
import { RunView } from './screens/RunView.js'
import { Explorer } from './screens/Explorer.js'
import { isLive, killAll, startRun, ui } from './store.js'

beforeAll(() => { process.env.SERJEANT_CLAUDE = resolve('test/fake-claude.mjs') })
afterAll(killAll)

const until = async (frame: () => string | undefined, text: string) => {
  for (let i = 0; i < 200 && !frame()?.includes(text); i++) await new Promise(r => setTimeout(r, 25))
  expect(frame()).toContain(text)
}
const tick = () => new Promise(r => setTimeout(r, 60))

test('explorer: j/k move, / filters live, : commands apply', async () => {
  const noop = () => {}
  const { lastFrame, stdin } = render(<Explorer demo config={defaults()} go={noop} handoff={noop} />)
  await until(lastFrame, 'ENG-123 · Add retry') // first ticket selected
  stdin.write('j'); await tick()
  expect(lastFrame()).toContain('ENG-140 · Auth refactor')
  stdin.write('/'); await tick(); stdin.write('pricing'); await tick()
  expect(lastFrame()).toContain('WEB-12')
  expect(lastFrame()).not.toContain('ENG-151')
  stdin.write('\r'); await tick()
  stdin.write(':'); await tick(); stdin.write('clear'); await tick(); stdin.write('\r'); await tick()
  expect(lastFrame()).toContain('ENG-151')
})

test('explorer: keys arriving in one chunk each apply (jjj moves three rows)', async () => {
  ui.filter = ''; ui.cursor = 0
  const noop = () => {}
  const { lastFrame, stdin } = render(<Explorer demo config={defaults()} go={noop} handoff={noop} />)
  await until(lastFrame, 'ENG-123')
  stdin.write('jjj'); await tick()
  expect(lastFrame()).toContain('WEB-12 · Fix typo') // ENG-123, ENG-140, ENG-151, WEB-12
  ui.cursor = 0
})

test('explorer: s with no repos configured says how to fix it', async () => {
  ui.filter = ''
  const noop = () => {}
  const { lastFrame, stdin } = render(<Explorer demo config={defaults()} go={noop} handoff={noop} />)
  await until(lastFrame, 'ENG-123')
  stdin.write('s'); await tick()
  expect(lastFrame()).toContain('Start ENG-123 with')
  stdin.write('\r'); await tick()
  expect(lastFrame()).toContain('no repos configured')
})

test('run view: permission prompt is answered with a, then reply goes to the agent', async () => {
  const t = DEMO[0]
  const w = { key: 'UI-1', repo: 'r', path: process.cwd(), branch: 'b', macro: 'implement', sessionId: null, runState: 'idle' as const, ticket: { ...t, key: 'UI-1' } }
  workPut(w)
  startRun(w, { mode: 'headless', flags: [], prompt: 'x' }, 'go')
  const { lastFrame, stdin } = render(<RunView wkey="UI-1" config={defaults()} back={() => {}} review={() => {}} handoff={() => {}} />)
  await until(lastFrame, 'Allow Write')
  stdin.write('a')
  await until(lastFrame, 'asking')
  stdin.write('i'); await tick(); stdin.write('foo.txt'); await tick(); stdin.write('\r')
  await until(lastFrame, 'ok: foo.txt')
})

test('explorer: surfaces config errors and flags worktrees whose ticket closed', async () => {
  const gone = { ...DEMO[0], key: 'OLD-1', title: 'Closed long ago' }
  workPut({ key: 'OLD-1', repo: 'r', path: '/nowhere', branch: 'b', macro: 'implement', sessionId: null, runState: 'done', ticket: gone })
  const noop = () => {}
  const { lastFrame } = render(<Explorer demo config={defaults()} configError="config: macros.x.mode: bad" go={noop} handoff={noop} />)
  await until(lastFrame, 'config: macros.x.mode: bad')
  expect(lastFrame()).toContain('Worktree left')
  expect(lastFrame()).toMatch(/⚑ OLD-1/)
})

test('explorer: :config opens the editor on the config file, creating a template', async () => {
  const seen: any[] = []
  process.env.SERJEANT_EDITOR = 'myeditor'
  const { lastFrame, stdin } = render(<Explorer demo config={defaults()} go={() => {}} handoff={h => seen.push(h)} />)
  await until(lastFrame, 'ENG-123')
  stdin.write(':'); await tick(); stdin.write('config'); await tick(); stdin.write('\r'); await tick()
  expect(seen).toEqual([{ cmd: 'myeditor', args: [process.env.SERJEANT_CONFIG], cwd: process.cwd() }])
  expect(readFileSync(process.env.SERJEANT_CONFIG!, 'utf8')).toContain('[writeback]')
  delete process.env.SERJEANT_EDITOR
})

test('explorer: :done refuses while the agent runs; :done! stops it', async () => {
  const key = 'LIVE-1'
  const w = { key, repo: 'r', path: process.cwd(), branch: 'b', macro: 'implement', sessionId: null, runState: 'idle' as const, ticket: { ...DEMO[0], key } }
  workPut(w)
  startRun(w, { mode: 'headless', flags: [], prompt: 'x' }, 'go')
  await tick()
  expect(isLive(key)).toBe(true)
  const noop = () => {}
  const { lastFrame, stdin } = render(<Explorer demo config={defaults()} go={noop} handoff={noop} />)
  await until(lastFrame, 'ENG-123')
  stdin.write(':'); await tick(); stdin.write(`done ${key}`); await tick(); stdin.write('\r')
  await until(lastFrame, 'still running')
  stdin.write(':'); await tick(); stdin.write(`done! ${key}`); await tick(); stdin.write('\r')
  await until(lastFrame, 'worktree removed')
  expect(isLive(key)).toBe(false)
})
