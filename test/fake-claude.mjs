#!/usr/bin/env node
// Fake `claude -p` speaking stream-json, for tests. First message: tool + permission + a question.
import { createInterface } from 'node:readline'
const out = o => process.stdout.write(JSON.stringify(o) + '\n')
const text = t => out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
let n = 0
let waiting = null
const sid = process.argv[process.argv.indexOf('--session-id') + 1] || process.argv[process.argv.indexOf('--resume') + 1]
out({ type: 'system', subtype: 'hook_started' })
out({ type: 'system', subtype: 'init', session_id: sid, args: process.argv.slice(2) })
createInterface({ input: process.stdin }).on('line', async line => {
  const m = JSON.parse(line)
  if (m.type === 'control_response') return waiting?.(m.response.response)
  const msg = m.message.content
  if (n++ === 0 && !msg.includes('NOASK')) {
    text('starting')
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x.txt', content: 'hi' } }] } })
    const decision = await new Promise(r => { waiting = r; out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'x.txt' } } }) })
    out({ type: 'user', message: { content: [{ type: 'tool_result', content: decision.behavior === 'allow' ? 'written' : 'denied' }] } })
    text(`decision ${decision.behavior}. Which name?`)
  } else text(`ok: ${msg}`)
  out({ type: 'result', subtype: 'success', is_error: false })
})
