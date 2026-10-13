import { afterEach, expect, test, vi } from 'vitest'
import { defaults } from './config.js'
import { writeback } from './writeback.js'

afterEach(() => vi.unstubAllGlobals())

test('writeback is a no-op without a target state or an api key', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(await writeback(defaults(), 'k', 'ENG-1', 'start')).toBeUndefined()
  const cfg = { ...defaults(), writeback: { on_start: 'started', assign_on_start: false } }
  expect(await writeback(cfg, undefined, 'ENG-1', 'start')).toBeUndefined()
  expect(await writeback(cfg, 'k', 'ENG-1', 'pr')).toBeUndefined() // on_pr unset
  expect(fetch).not.toHaveBeenCalled()
})
