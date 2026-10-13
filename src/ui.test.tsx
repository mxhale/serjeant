import { resolve } from 'node:path'
import { render } from 'ink-testing-library'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaults } from './config.js'
import { workPut } from './db.js'
import { DEMO } from './linear.js'
import { RunView } from './screens/RunView.js'
import { Explorer } from './screens/Explorer.js'
import { killAll, startRun, ui } from './store.js'

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
