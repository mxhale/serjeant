import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaults } from './config.js'
import { commentsList, viewedList, workPut } from './db.js'
import { DEMO } from './linear.js'
import { Review } from './screens/Review.js'
import { getView, killAll } from './store.js'
import { createWorktree } from './work.js'

beforeAll(() => { process.env.SERJEANT_CLAUDE = resolve('test/fake-claude.mjs') })
afterAll(killAll)

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' })
const until = async (frame: () => string | undefined, text: string) => {
  for (let i = 0; i < 200 && !frame()?.includes(text); i++) await new Promise(r => setTimeout(r, 25))
  expect(frame()).toContain(text)
}
const tick = () => new Promise(r => setTimeout(r, 60))

test('review: comment on a changed line, mark viewed, send to the agent', async () => {
  const repo = join(mkdtempSync(join(tmpdir(), 'sj-rui-')), 'api')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  sh(repo, 'config', 'user.email', 't@t'); sh(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init')
  const path = createWorktree(repo, 'REV-1', 'rev-1')
  writeFileSync(join(path, 'a.txt'), 'one\nTWO\nthree\n')
  workPut({ key: 'REV-1', repo: 'api', path, branch: 'rev-1', macro: 'implement', sessionId: null, runState: 'idle', ticket: { ...DEMO[0], key: 'REV-1' } })

  let wentToRun = false
  const { lastFrame, stdin } = render(<Review wkey="REV-1" config={defaults()} back={() => {}} toRun={() => { wentToRun = true }} />)
  await until(lastFrame, '+ TWO')
  expect(lastFrame()).toContain('M a.txt')

  stdin.write('j'); await tick(); stdin.write('j'); await tick(); stdin.write('j'); await tick() // hunk -> one -> two(del) -> TWO(add)
  stdin.write('c'); await tick(); stdin.write('why caps?'); await tick(); stdin.write('\r')
  await until(lastFrame, '💬 why caps?')
  const [c] = commentsList('REV-1')
  expect(c).toMatchObject({ file: 'a.txt', side: 'new', line: 2, endLine: 2, code: 'TWO', text: 'why caps?', sent: false })

  await tick(); stdin.write('m'); await tick()
  expect([...viewedList('REV-1')]).toEqual(['a.txt'])

  stdin.write('Z')
  await until(() => String(wentToRun), 'true')
  expect(commentsList('REV-1')[0].sent).toBe(true)
  for (let i = 0; i < 100 && !getView('REV-1').items.some(it => it.kind === 'user'); i++) await tick()
  const sent = getView('REV-1').items.find(it => it.kind === 'user')
  expect(sent).toMatchObject({ text: expect.stringContaining('a.txt:2 (current code)') })
})
