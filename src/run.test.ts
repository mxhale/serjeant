import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import { emptyView, endsWithQuestion, handoffArgs, headlessArgs, logPath, reduce, replayLog, Run } from './run.js'

beforeAll(() => { process.env.SERJEANT_CLAUDE = resolve('test/fake-claude.mjs') })

const waitFor = async (run: Run, state: string) => {
  for (let i = 0; i < 200 && run.view.state !== state; i++) await new Promise(r => setTimeout(r, 25))
  expect(run.view.state).toBe(state)
}

test('reducer: tool use, permission ask, question vs done', () => {
  let v = reduce(emptyView(), { type: 'system', subtype: 'init', session_id: 's1' })
  expect(v.state).toBe('working')
  v = reduce(v, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })
  expect(v.items.at(-1)).toEqual({ kind: 'tool', name: 'Bash', summary: 'ls' })
  v = reduce(v, { type: 'control_request', request_id: 'r', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a' } } })
  expect(v.state).toBe('permission')
  expect(v.pending?.summary).toBe('a')
  v = reduce(v, { type: 'assistant', message: { content: [{ type: 'text', text: 'Which one?' }] } })
  expect(reduce(v, { type: 'result', subtype: 'success' }).state).toBe('asking')
  v = reduce(v, { type: 'assistant', message: { content: [{ type: 'text', text: 'All done.' }] } })
  expect(reduce(v, { type: 'result', subtype: 'success' }).state).toBe('done')
  expect(reduce(v, { type: 'result', subtype: 'error_max_turns' }).state).toBe('failed')
})

test('question detector tolerates trailing markdown', () => {
  expect(endsWithQuestion('Use **tabs or spaces?**')).toBe(true)
  expect(endsWithQuestion('Done. Tests pass.')).toBe(false)
})

test('arg builders: first launch sets session id, later resumes', () => {
  expect(headlessArgs(['--permission-mode', 'plan'], 'S', false)).toContain('--session-id')
  expect(headlessArgs([], 'S', true).slice(-2)).toEqual(['--resume', 'S'])
  expect(handoffArgs(['-x'], 'S', false, 'do it')).toEqual(['-x', '--session-id', 'S', 'do it'])
  expect(handoffArgs([], 'S', true)).toEqual(['--resume', 'S'])
})

test('process: permission allow, then question, then reply on same process', async () => {
  const run = new Run('T-1', () => {})
  run.start(process.cwd(), headlessArgs([], 'sess-1', false), 'go', 'sess-1')
  await waitFor(run, 'permission')
  expect(run.view.pending?.tool).toBe('Write')
  run.answer(true)
  await waitFor(run, 'asking')
  expect(run.view.items.some(i => i.kind === 'result' && i.text === 'written')).toBe(true)
  run.send('foo.txt')
  await waitFor(run, 'done')
  expect(run.view.items.at(-1)).toEqual({ kind: 'text', text: 'ok: foo.txt' })
  run.kill()
})

test('process: deny reaches the agent; log replays to the same final view', async () => {
  const run = new Run('T-2', () => {})
  run.start(process.cwd(), headlessArgs([], 'sess-2', false), 'go', 'sess-2')
  await waitFor(run, 'permission')
  run.answer(false)
  await waitFor(run, 'asking')
  expect(run.view.lastText).toContain('decision deny')
  const replayed = replayLog('T-2')!
  expect(replayed.state).toBe('asking')
  expect(replayed.sessionId).toBe('sess-2')
  expect(readFileSync(logPath('T-2'), 'utf8')).not.toContain('hook_started')
  run.kill()
})

test('killing a live run marks it interrupted; a crash marks it failed', async () => {
  const run = new Run('T-3', () => {})
  run.start(process.cwd(), headlessArgs([], 'sess-3', false), 'go', 'sess-3')
  await waitFor(run, 'permission')
  run.kill()
  await waitFor(run, 'interrupted')
  process.env.SERJEANT_CLAUDE = '/nonexistent/claude'
  const bad = new Run('T-4', () => {})
  bad.start(process.cwd(), [], 'go', 's')
  await waitFor(bad, 'failed')
  process.env.SERJEANT_CLAUDE = resolve('test/fake-claude.mjs')
})
