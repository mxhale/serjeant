import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = process.env.SERJEANT_STATE ?? join(homedir(), '.local', 'state', 'serjeant')
mkdirSync(dir, { recursive: true })

const db = new DatabaseSync(join(dir, 'serjeant.db'))
db.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL)')

export function cacheGet<T>(k: string): T | undefined {
  const row = db.prepare('SELECT v FROM cache WHERE k = ?').get(k) as { v: string } | undefined
  return row ? (JSON.parse(row.v) as T) : undefined
}

export function cacheSet(k: string, v: unknown) {
  db.prepare('INSERT OR REPLACE INTO cache (k, v) VALUES (?, ?)').run(k, JSON.stringify(v))
}
