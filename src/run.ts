import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateDir, type RunState } from './db.js'

export type Item =
  | { kind: 'text'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; text: string }
  | { kind: 'note'; text: string }

export type Pending = { requestId: string; tool: string; summary: string; input: unknown }

export type View = { sessionId?: string; state: RunState; items: Item[]; pending?: Pending; lastText: string }

export const emptyView = (): View => ({ state: 'idle', items: [], lastText: '' })

const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '…' : s)

function summarize(tool: string, input: any): string {
  if (!input) return ''
  if (tool === 'Bash') return clip(String(input.command ?? ''))
  if (input.file_path) return String(input.file_path)
  return clip(JSON.stringify(input))
}

// A finished turn that ends in a question means the agent is waiting on a human answer.
export const endsWithQuestion = (text: string) => /\?[\s*_`"')\]]*$/.test(text.trim())

export function reduce(v: View, ev: any): View {
  const items = v.items
  switch (ev?.type) {
    case 'system':
      return ev.subtype === 'init' ? { ...v, sessionId: ev.session_id ?? v.sessionId, state: 'working' } : v
    case 'assistant': {
      let lastText = v.lastText
      const added: Item[] = []
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text' && c.text.trim()) { added.push({ kind: 'text', text: c.text }); lastText = c.text }
        else if (c.type === 'tool_use') added.push({ kind: 'tool', name: c.name, summary: summarize(c.name, c.input) })
      }
      return { ...v, items: [...items, ...added], lastText, state: v.state === 'idle' ? 'working' : v.state }
    }
    case 'user': {
      const added: Item[] = []
      const content = ev.message?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type !== 'tool_result') continue
          const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((p: any) => p.text ?? '').join('')
          added.push({ kind: 'result', text: clip(text.replace(/\s+/g, ' ').trim(), 160) })
        }
      }
      return added.length ? { ...v, items: [...items, ...added] } : v
    }
    case 'sj_user': // our own log entry for messages we sent
      return { ...v, state: 'working', items: [...items, { kind: 'user', text: ev.text }] }
    case 'control_request':
      if (ev.request?.subtype !== 'can_use_tool') return v
      return {
        ...v, state: 'permission',
        pending: { requestId: ev.request_id, tool: ev.request.tool_name, summary: summarize(ev.request.tool_name, ev.request.input), input: ev.request.input },
      }
    case 'control_cancel_request':
      return v.pending?.requestId === ev.request_id ? { ...v, pending: undefined, state: 'working' } : v
    case 'result': {
      if (ev.subtype !== 'success' || ev.is_error) {
        const why = ev.result ?? ev.subtype ?? 'error'
        return { ...v, state: 'failed', pending: undefined, items: [...items, { kind: 'note', text: `failed: ${clip(String(why))}` }] }
      }
      return { ...v, state: endsWithQuestion(v.lastText) ? 'asking' : 'done', pending: undefined }
    }
    default:
      return v
  }
}

export const logPath = (key: string) => join(stateDir(), 'logs', `${key}.jsonl`)

// Rebuild a view from a previous session's log, so finished runs stay readable after a restart.
export function replayLog(key: string): View | undefined {
  const p = logPath(key)
  if (!existsSync(p)) return undefined
  let v = emptyView()
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue
    try { v = reduce(v, JSON.parse(line)) } catch { /* partial line */ }
  }
  return v
}

export const claudeBin = () => process.env.SERJEANT_CLAUDE ?? 'claude'

export const headlessArgs = (flags: string[], sessionId: string, resume: boolean) => [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-prompt-tool', 'stdio',
  ...flags,
  ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
]

// Interactive claude in the worktree; prompt (first launch only) is the initial message.
export const handoffArgs = (flags: string[], sessionId: string, resume: boolean, prompt?: string) => [
  ...flags,
  ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
  ...(prompt ? [prompt] : []),
]

export class Run {
  view: View = emptyView()
  private child?: ChildProcessWithoutNullStreams
  private buf = ''
  private log: string
  killed = false

  constructor(private key: string, private onChange: () => void) {
    this.log = logPath(key)
    mkdirSync(join(stateDir(), 'logs'), { recursive: true })
  }

  get alive() { return !!this.child && this.child.exitCode === null && !this.killed }

  start(cwd: string, args: string[], firstMessage: string, sessionId: string) {
    this.view = { ...emptyView(), sessionId, state: 'working' }
    this.child = spawn(claudeBin(), args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const child = this.child
    let stderr = ''
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-500) })
    child.stdout.on('data', d => this.feed(String(d)))
    child.on('error', e => this.end(`could not start claude: ${e.message}`))
    child.on('exit', code => {
      if (this.child !== child) return
      if (this.killed) this.set({ ...this.view, state: 'interrupted' })
      else if (code !== 0 && this.view.state !== 'done' && this.view.state !== 'asking') this.end(`claude exited ${code}: ${stderr.trim()}`)
      else this.onChange()
    })
    this.send(firstMessage)
  }

  private end(note: string) {
    this.set({ ...this.view, state: 'failed', pending: undefined, items: [...this.view.items, { kind: 'note', text: note }] })
  }

  private set(v: View) { this.view = v; this.onChange() }

  private feed(chunk: string) {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      let ev: any
      try { ev = JSON.parse(line) } catch { continue }
      if (ev.type === 'system' && ev.subtype?.startsWith('hook')) continue // keep logs small
      appendFileSync(this.log, line + '\n')
      this.set(reduce(this.view, ev))
    }
  }

  private write(o: object) { this.child?.stdin.write(JSON.stringify(o) + '\n') }

  send(text: string) {
    this.write({ type: 'user', message: { role: 'user', content: text } })
    const ev = { type: 'sj_user', text }
    appendFileSync(this.log, JSON.stringify(ev) + '\n')
    this.set(reduce(this.view, ev))
  }

  answer(allow: boolean) {
    const p = this.view.pending
    if (!p) return
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success', request_id: p.requestId,
        response: allow ? { behavior: 'allow', updatedInput: p.input } : { behavior: 'deny', message: 'Denied by user' },
      },
    })
    this.set({ ...this.view, pending: undefined, state: 'working' })
  }

  kill() {
    if (!this.alive) return
    this.killed = true
    this.child!.kill('SIGTERM')
  }
}
