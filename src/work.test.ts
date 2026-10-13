import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { defaults } from './config.js'
import { workGet } from './db.js'
import { DEMO } from './linear.js'
import { baseRef, createWorktree, finishWork, git, removeWorktree, renderPrompt, startWork } from './work.js'

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' })

function repo() {
  const dir = join(mkdtempSync(join(tmpdir(), 'sj-repo-')), 'api')
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a')
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'init')
  return dir
}

const ticket = { ...DEMO[0], key: 'ENG-9', branch: 'max/eng-9-thing' }

test('renderPrompt fills known vars, leaves unknown', () => {
  expect(renderPrompt('{{ticket.key}} {{ branch }} {{nope}}', ticket, 'b')).toBe('ENG-9 b {{nope}}')
})

test('worktree is created on the ticket branch, idempotently, removed when clean', () => {
  const r = repo()
  expect(baseRef(r)).toBe('main')
  const p = createWorktree(r, 'ENG-9', 'max/eng-9-thing')
  expect(git(p, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('max/eng-9-thing')
  expect(createWorktree(r, 'ENG-9', 'max/eng-9-thing')).toBe(p)
  removeWorktree(r, p)
  expect(existsSync(p)).toBe(false)
})

test('removal refuses dirty trees and unpushed commits unless forced', () => {
  const r = repo()
  const p = createWorktree(r, 'ENG-9', 'max/eng-9-thing')
  writeFileSync(join(p, 'new.txt'), 'x')
  expect(() => removeWorktree(r, p)).toThrow(/uncommitted/)
  sh(p, 'add', '.'); sh(p, 'commit', '-qm', 'work')
  expect(() => removeWorktree(r, p)).toThrow(/1 unpushed/)
  removeWorktree(r, p, true)
  expect(existsSync(p)).toBe(false)
})

test('startWork persists a row; finishWork removes worktree and row', () => {
  const r = repo()
  const config = { ...defaults(), repos: { api: r } }
  const w = startWork(config, ticket, 'implement', 'api')
  expect(workGet('ENG-9')?.path).toBe(w.path)
  expect(startWork(config, ticket, 'plan', 'api').macro).toBe('implement') // existing wins
  finishWork(config, 'ENG-9')
  expect(workGet('ENG-9')).toBeUndefined()
  expect(existsSync(w.path)).toBe(false)
})

test('unknown repo is a clear error', () => {
  expect(() => startWork(defaults(), ticket, 'implement', 'nope')).toThrow(/unknown repo/)
})
