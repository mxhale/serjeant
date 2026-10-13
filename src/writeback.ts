import type { Config } from './config.js'
import { transition } from './linear.js'

// Config-driven Linear updates. Resolves to the new state name, or undefined when disabled/offline.
export async function writeback(config: Config, apiKey: string | undefined, key: string, event: 'start' | 'pr') {
  const target = event === 'start' ? config.writeback.on_start : config.writeback.on_pr
  if (!target || !apiKey) return undefined
  return transition(apiKey, key, target, event === 'start' && config.writeback.assign_on_start)
}
