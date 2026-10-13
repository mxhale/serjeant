import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { repoPath, type Config } from './config.js'
import { workDel, workGet, workPut, type Work } from './db.js'
import type { Ticket } from './linear.js'

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const ok = (cwd: string, ...args: string[]) => {
  try { git(cwd, ...args); return true } catch { return false }
}

export function renderPrompt(tpl: string, t: Ticket, branch: string) {
  const vars: Record<string, string> = {
    'ticket.key': t.key, 'ticket.title': t.title, 'ticket.body': t.body, 'ticket.url': t.url, branch,
  }
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => vars[k] ?? m)
}

// The ref new branches start from, and the ref "unpushed" is measured against.
export function baseRef(repo: string) {
  const remote = (() => { try { return git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD') } catch { return '' } })()
  if (remote) return remote
  for (const b of ['main', 'master']) if (ok(repo, 'rev-parse', '--verify', `refs/heads/${b}`)) return b
  return git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
}

export const worktreePath = (repo: string, key: string) =>
  join(dirname(repo), '.serjeant-worktrees', basename(repo), key)

export function createWorktree(repo: string, key: string, branch: string) {
  const path = worktreePath(repo, key)
  if (existsSync(path)) return path
  mkdirSync(dirname(path), { recursive: true })
  if (ok(repo, 'rev-parse', '--verify', `refs/heads/${branch}`)) git(repo, 'worktree', 'add', path, branch)
  else git(repo, 'worktree', 'add', '-b', branch, path, baseRef(repo))
  return path
}

export function worktreeStatus(path: string, repo: string) {
  const dirty = git(path, 'status', '--porcelain') !== ''
  const upstream = ok(path, 'rev-parse', '--abbrev-ref', '@{u}')
  const range = `${upstream ? '@{u}' : baseRef(repo)}..HEAD`
  return { dirty, unpushed: Number(git(path, 'rev-list', '--count', range)), hasUpstream: upstream }
}

export function removeWorktree(repo: string, path: string, force = false) {
  if (existsSync(path) && !force) {
    const s = worktreeStatus(path, repo)
    if (s.dirty) throw new Error('uncommitted changes (:done! to discard)')
    if (s.unpushed) throw new Error(`${s.unpushed} unpushed commit(s) (:done! to discard)`)
  }
  if (existsSync(path)) git(repo, 'worktree', 'remove', ...(force ? ['--force'] : []), path)
}

export function startWork(config: Config, t: Ticket, macro: string, repoName: string): Work {
  const existing = workGet(t.key)
  if (existing) return existing
  const repo = repoPath(config, repoName)
  if (!repo) throw new Error(`unknown repo "${repoName}" (add it under [repos])`)
  if (!ok(repo, 'rev-parse', '--git-dir')) throw new Error(`${repo} is not a git repo`)
  const path = createWorktree(repo, t.key, t.branch)
  const w: Work = { key: t.key, repo: repoName, path, branch: t.branch, macro, sessionId: null, runState: 'idle', ticket: t }
  workPut(w)
  return w
}

export function finishWork(config: Config, key: string, force = false) {
  const w = workGet(key)
  if (!w) throw new Error(`${key} has no worktree`)
  const repo = repoPath(config, w.repo)
  if (repo) removeWorktree(repo, w.path, force)
  workDel(key)
}
