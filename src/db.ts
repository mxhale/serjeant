import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Ticket } from './linear.js'

export const stateDir = () => process.env.SERJEANT_STATE ?? join(homedir(), '.local', 'state', 'serjeant')

// Loaded via require: esbuild would rewrite a static `node:sqlite` import to bare `sqlite` and break the bundle.
let db: DatabaseSync | undefined
const get = () => {
  if (db) return db
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
  mkdirSync(stateDir(), { recursive: true })
  db = new DatabaseSync(join(stateDir(), 'serjeant.db'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work (
      key TEXT PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL,
      macro TEXT NOT NULL, session_id TEXT, run_state TEXT NOT NULL DEFAULT 'idle', ticket TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, file TEXT NOT NULL,
      line INTEGER NOT NULL, end_line INTEGER NOT NULL, side TEXT NOT NULL,
      code TEXT NOT NULL, text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS viewed (key TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY (key, file));
  `)
  return db
}

export function cacheGet<T>(k: string): T | undefined {
  const row = get().prepare('SELECT v FROM cache WHERE k = ?').get(k) as { v: string } | undefined
  return row ? (JSON.parse(row.v) as T) : undefined
}

export function cacheSet(k: string, v: unknown) {
  get().prepare('INSERT OR REPLACE INTO cache (k, v) VALUES (?, ?)').run(k, JSON.stringify(v))
}

// ---- work: one row per started ticket (worktree + Claude session)

export type RunState = 'idle' | 'working' | 'permission' | 'asking' | 'done' | 'failed' | 'interrupted'

export type Work = {
  key: string
  repo: string
  path: string
  branch: string
  macro: string
  sessionId: string | null
  runState: RunState
  ticket: Ticket
}

const toWork = (r: any): Work => ({
  key: r.key, repo: r.repo, path: r.path, branch: r.branch, macro: r.macro,
  sessionId: r.session_id, runState: r.run_state, ticket: JSON.parse(r.ticket),
})

export const workGet = (key: string) => {
  const r = get().prepare('SELECT * FROM work WHERE key = ?').get(key)
  return r ? toWork(r) : undefined
}

export const workAll = () => (get().prepare('SELECT * FROM work ORDER BY key').all() as any[]).map(toWork)

export function workPut(w: Work) {
  get().prepare(
    `INSERT OR REPLACE INTO work (key, repo, path, branch, macro, session_id, run_state, ticket)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(w.key, w.repo, w.path, w.branch, w.macro, w.sessionId, w.runState, JSON.stringify(w.ticket))
}

export function workPatch(key: string, p: Partial<Pick<Work, 'sessionId' | 'runState' | 'macro'>>) {
  if (p.sessionId !== undefined) get().prepare('UPDATE work SET session_id = ? WHERE key = ?').run(p.sessionId, key)
  if (p.runState !== undefined) get().prepare('UPDATE work SET run_state = ? WHERE key = ?').run(p.runState, key)
  if (p.macro !== undefined) get().prepare('UPDATE work SET macro = ? WHERE key = ?').run(p.macro, key)
}

export function workDel(key: string) {
  get().prepare('DELETE FROM work WHERE key = ?').run(key)
  get().prepare('DELETE FROM comments WHERE key = ?').run(key)
  get().prepare('DELETE FROM viewed WHERE key = ?').run(key)
}

// Runs that were live when serjeant last exited can't still be running.
export const workMarkInterrupted = () =>
  void get().prepare(`UPDATE work SET run_state = 'interrupted' WHERE run_state IN ('working', 'permission', 'asking')`).run()

// ---- review comments + viewed files

export type Comment = {
  id: number; key: string; file: string; line: number; endLine: number
  side: 'new' | 'old'; code: string; text: string; sent: boolean
}

const toComment = (r: any): Comment => ({
  id: r.id, key: r.key, file: r.file, line: r.line, endLine: r.end_line,
  side: r.side, code: r.code, text: r.text, sent: !!r.sent,
})

export const commentsList = (key: string) =>
  (get().prepare('SELECT * FROM comments WHERE key = ? ORDER BY file, line, id').all(key) as any[]).map(toComment)

export function commentAdd(c: Omit<Comment, 'id' | 'sent'>) {
  get().prepare(
    'INSERT INTO comments (key, file, line, end_line, side, code, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(c.key, c.file, c.line, c.endLine, c.side, c.code, c.text)
}

export const commentDel = (id: number) => void get().prepare('DELETE FROM comments WHERE id = ?').run(id)

export const commentsMarkSent = (key: string) =>
  void get().prepare('UPDATE comments SET sent = 1 WHERE key = ?').run(key)

export const viewedList = (key: string) =>
  new Set((get().prepare('SELECT file FROM viewed WHERE key = ?').all(key) as { file: string }[]).map(r => r.file))

export function viewedToggle(key: string, file: string) {
  const has = get().prepare('SELECT 1 FROM viewed WHERE key = ? AND file = ?').get(key, file)
  if (has) get().prepare('DELETE FROM viewed WHERE key = ? AND file = ?').run(key, file)
  else get().prepare('INSERT INTO viewed (key, file) VALUES (?, ?)').run(key, file)
}
