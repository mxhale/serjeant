import { useState } from 'react'
import { useApp } from 'ink'
import { loadConfig, macros } from './config.js'
import { workGet } from './db.js'
import { Explorer, editor } from './screens/Explorer.js'
import { Review } from './screens/Review.js'
import { RunView } from './screens/RunView.js'
import { claudeHandoff, ui, type Handoff, type Screen } from './store.js'

export function App({ apiKey, demo }: { apiKey?: string; demo: boolean }) {
  const { exit } = useApp()
  const [{ config, error }] = useState(loadConfig) // re-read on every mount, i.e. after :config
  const [screen, setScreen] = useState<Screen>(ui.screen)

  const go = (s: Screen) => { ui.screen = s; setScreen(s) }
  const handoff = (h: Handoff) => { ui.handoff = h; exit() }
  const handoffFor = (key: string, what: 'nvim' | 'claude') => {
    const w = workGet(key)
    if (!w) return
    if (what === 'nvim') handoff({ cmd: editor(), args: [], cwd: w.path })
    else handoff(claudeHandoff(w, macros(config)[w.macro] ?? macros(config).implement))
  }

  if (screen.name === 'run') {
    return (
      <RunView
        wkey={screen.key}
        config={config}
        back={() => go({ name: 'explorer' })}
        review={() => go({ name: 'review', key: screen.key })}
        handoff={what => handoffFor(screen.key, what)}
      />
    )
  }
  if (screen.name === 'review') {
    return (
      <Review
        wkey={screen.key}
        config={config}
        apiKey={apiKey}
        back={() => go({ name: 'explorer' })}
        toRun={() => go({ name: 'run', key: screen.key })}
      />
    )
  }
  return <Explorer apiKey={apiKey} demo={demo} config={config} configError={error} go={go} handoff={handoff} />
}
