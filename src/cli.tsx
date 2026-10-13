import { spawnSync } from 'node:child_process'
import { render } from 'ink'
import { App } from './app.js'
import { killAll, ui } from './store.js'

const demo = process.argv.includes('--demo')
const apiKey = process.env.LINEAR_API_KEY

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'

process.on('exit', killAll)
process.stdout.write(ALT_ON)
try {
  // ponytail: handoff = unmount ink, give the terminal to the child, remount. Screen state lives in store.ts.
  for (;;) {
    const { waitUntilExit } = render(<App apiKey={apiKey} demo={demo} />)
    await waitUntilExit()
    const h = ui.handoff
    if (!h) break
    ui.handoff = undefined
    process.stdout.write(ALT_OFF)
    const r = spawnSync(h.cmd, h.args, { cwd: h.cwd, stdio: 'inherit' })
    if (r.error) ui.status = `could not run ${h.cmd}: ${r.error.message}`
    process.stdout.write(ALT_ON)
  }
} finally {
  killAll()
  process.stdout.write(ALT_OFF)
}
