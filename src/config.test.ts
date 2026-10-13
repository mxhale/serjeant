import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { BUILTIN_MACROS, loadConfig, macros, resolveRepo } from './config.js'
import { DEMO } from './linear.js'

const write = (toml: string) => {
  const p = join(mkdtempSync(join(tmpdir(), 'sj-cfg-')), 'config.toml')
  writeFileSync(p, toml)
  return p
}

test('missing file gives defaults and built-in macros', () => {
  const { config, error } = loadConfig('/nonexistent/config.toml')
  expect(error).toBeUndefined()
  expect(Object.keys(macros(config))).toEqual(Object.keys(BUILTIN_MACROS))
})

test('valid config parses; user macro overrides built-in', () => {
  const { config, error } = loadConfig(write(`
[repos]
api = "/code/api"
[teams.ENG]
repo = "api"
[macros.implement]
mode = "handoff"
prompt = "go"
`))
  expect(error).toBeUndefined()
  expect(macros(config).implement.mode).toBe('handoff')
})

test('invalid values report the path, toml syntax errors report too', () => {
  expect(loadConfig(write(`[macros.x]\nmode = "bogus"\nprompt = "p"`)).error).toMatch(/macros\.x\.mode/)
  expect(loadConfig(write(`[macros.x\nmode =`)).error).toMatch(/^config:/)
})

test('repo resolves by label first, then team, else undefined', () => {
  const { config } = loadConfig(write(`
[repos]
api = "/code/api"
web = "/code/web"
[teams.ENG]
repo = "api"
[teams.ENG.labels]
frontend = "web"
`))
  const eng = DEMO.find(t => t.key === 'ENG-140')!
  expect(resolveRepo(config, eng)?.name).toBe('api')
  expect(resolveRepo(config, { ...eng, labels: ['frontend'] })?.name).toBe('web')
  expect(resolveRepo(config, DEMO.find(t => t.team === 'WEB')!)).toBeUndefined()
})
