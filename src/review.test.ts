import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { defaults } from './config.js'
import type { Work } from './db.js'
import { DEMO } from './linear.js'
import { approve, diffFor, formatReview, parseDiff, type Exec } from './review.js'
import { createWorktree } from './work.js'

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sj-rev-'))
  const origin = join(root, 'origin.git')
  const repo = join(root, 'api')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  sh(repo, 'config', 'user.email', 't@t'); sh(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repo, 'gone.txt'), 'bye\n')
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init')
  sh(repo, 'remote', 'add', 'origin', origin); sh(repo, 'push', '-q', '-u', 'origin', 'main')
  const wt = createWorktree(repo, 'ENG-9', 'max/eng-9')
  return { repo, wt }
}

test('parseDiff: statuses, hunks and line numbers', () => {
  const files = parseDiff(`diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
diff --git a/n.txt b/n.txt
new file mode 100644
--- /dev/null
+++ b/n.txt
@@ -0,0 +1,1 @@
+hi
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`)
  expect(files.map(f => [f.path, f.status, f.binary])).toEqual([['a.txt', 'M', false], ['n.txt', 'A', false], ['img.png', 'M', true]])
  expect(files[0].hunks[0].lines).toEqual([
    { kind: 'ctx', text: 'one', oldNo: 1, newNo: 1 },
    { kind: 'del', text: 'two', oldNo: 2 },
    { kind: 'add', text: 'TWO', newNo: 2 },
    { kind: 'ctx', text: 'three', oldNo: 3, newNo: 3 },
  ])
})

test('diffFor covers committed, uncommitted, deleted and untracked changes', () => {
  const { wt } = setup()
  writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\n'); sh(wt, 'commit', '-qam', 'edit')
  writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\nfour\n') // uncommitted on top
  rmSync(join(wt, 'gone.txt'))
  writeFileSync(join(wt, 'fresh.txt'), 'new\n') // untracked
  const files = diffFor(wt)
  expect(files.map(f => [f.path, f.status]).sort()).toEqual([['a.txt', 'M'], ['fresh.txt', 'A'], ['gone.txt', 'D']])
  const a = files.find(f => f.path === 'a.txt')!
  expect(a.hunks.flatMap(h => h.lines).filter(l => l.kind === 'add').map(l => l.text)).toEqual(['TWO', 'four'])
})

test('formatReview numbers comments and quotes the code', () => {
  const text = formatReview('ENG-9', [
    { file: 'a.txt', line: 2, endLine: 3, side: 'new', code: 'TWO\nthree', text: 'why?' },
    { file: 'b.txt', line: 1, endLine: 1, side: 'old', code: '', text: 'keep this' },
  ])
  expect(text).toContain('1. a.txt:2-3 (current code)')
  expect(text).toContain('   TWO\n   three')
  expect(text).toContain('2. b.txt:1 (removed code)\n   keep this')
})

const work = (wt: string): Work => ({ key: 'ENG-9', repo: 'api', path: wt, branch: 'max/eng-9', macro: 'implement', sessionId: null, runState: 'done', ticket: { ...DEMO[0], key: 'ENG-9' } })

test('approve refuses dirty trees and empty branches', async () => {
  const { wt } = setup()
  await expect(approve({ config: defaults(), work: work(wt) })).rejects.toThrow(/nothing to ship/)
  writeFileSync(join(wt, 'x.txt'), 'x'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'x')
  writeFileSync(join(wt, 'dirty.txt'), 'd'); sh(wt, 'add', '.')
  await expect(approve({ config: defaults(), work: work(wt) })).rejects.toThrow(/uncommitted/)
})

test('approve pushes then opens a PR; an existing PR url is reused', async () => {
  const { wt } = setup()
  writeFileSync(join(wt, 'x.txt'), 'x'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'x')
  const calls: string[] = []
  const exec: Exec = (cmd, args, cwd) => {
    calls.push(`${cmd} ${args[0]}`)
    if (cmd === 'gh') return 'https://github.com/o/r/pull/7'
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
  }
  expect(await approve({ config: defaults(), work: work(wt), exec })).toBe('https://github.com/o/r/pull/7')
  expect(calls).toEqual(['git push', 'gh pr'])
  expect(sh(wt, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/max/eng-9')

  const exists: Exec = (cmd, args, cwd) => {
    if (cmd === 'gh') throw Object.assign(new Error('x'), { stderr: 'a pull request for branch already exists:\nhttps://github.com/o/r/pull/7\n' })
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
  }
  expect(await approve({ config: defaults(), work: work(wt), exec: exists })).toBe('https://github.com/o/r/pull/7')
})
