import { execFileSync, spawnSync } from 'node:child_process'
import type { Config } from './config.js'
import type { Comment, Work } from './db.js'
import { baseRef, git, worktreeStatus } from './work.js'
import { writeback } from './writeback.js'

export type DLine = { kind: 'ctx' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }
export type Hunk = { header: string; lines: DLine[] }
export type FileDiff = { path: string; status: 'M' | 'A' | 'D' | 'R'; binary: boolean; hunks: Hunk[] }

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let f: FileDiff | undefined
  let h: Hunk | undefined
  let o = 0
  let n = 0
  for (const line of text.split('\n')) {
    const head = /^diff --git a\/.* b\/(.*)$/.exec(line)
    if (head) { f = { path: head[1], status: 'M', binary: false, hunks: [] }; files.push(f); h = undefined; continue }
    if (!f) continue
    const hh = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hh) { h = { header: line, lines: [] }; f.hunks.push(h); o = +hh[1]; n = +hh[2]; continue }
    if (!h) {
      if (line.startsWith('new file mode')) f.status = 'A'
      else if (line.startsWith('deleted file mode')) f.status = 'D'
      else if (line.startsWith('rename to ')) { f.status = 'R'; f.path = line.slice(10) }
      else if (line.startsWith('Binary files')) f.binary = true
      continue
    }
    if (line.startsWith('+')) h.lines.push({ kind: 'add', text: line.slice(1), newNo: n++ })
    else if (line.startsWith('-')) h.lines.push({ kind: 'del', text: line.slice(1), oldNo: o++ })
    else if (line.startsWith(' ')) h.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: o++, newNo: n++ })
    // "\ No newline at end of file" and blank trailing line: ignored
  }
  return files
}

// Everything the branch changed relative to where it forked: commits + uncommitted + untracked.
export function diffFor(path: string): FileDiff[] {
  let from = 'HEAD'
  try { from = git(path, 'merge-base', 'HEAD', baseRef(path)) } catch { /* no base: show only uncommitted */ }
  const tracked = execFileSync('git', ['diff', '--no-color', '--no-ext-diff', from], { cwd: path, encoding: 'utf8', maxBuffer: 1 << 28 })
  const untracked = git(path, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
  const extra = untracked.map(file =>
    // --no-index exits 1 when files differ, so read stdout regardless of status
    spawnSync('git', ['diff', '--no-color', '--no-index', '/dev/null', file], { cwd: path, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout,
  )
  return parseDiff([tracked, ...extra].join('\n'))
}

export function formatReview(key: string, comments: Pick<Comment, 'file' | 'line' | 'endLine' | 'side' | 'code' | 'text'>[]) {
  const items = comments.map((c, i) => {
    const range = c.endLine > c.line ? `${c.line}-${c.endLine}` : `${c.line}`
    const code = c.code ? `\n   \`\`\`\n${c.code.split('\n').map(l => '   ' + l).join('\n')}\n   \`\`\`` : ''
    return `${i + 1}. ${c.file}:${range} (${c.side === 'old' ? 'removed code' : 'current code'})${code}\n   ${c.text}`
  })
  return `Code review feedback on ${key}. Address each comment, then say what you changed:\n\n${items.join('\n\n')}`
}

export type Exec = (cmd: string, args: string[], cwd: string) => string
const defaultExec: Exec = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Push the branch and open a PR. Refuses uncommitted work. Resolves to the PR url.
export async function approve(opts: { config: Config; apiKey?: string; work: Work; exec?: Exec }): Promise<string> {
  const { config, apiKey, work: w, exec = defaultExec } = opts
  const s = worktreeStatus(w.path, w.path)
  if (s.dirty) throw new Error('uncommitted changes: ask the agent to commit first')
  if (!s.hasUpstream && s.unpushed === 0) throw new Error('nothing to ship: no commits on this branch')
  exec('git', ['push', '-u', 'origin', w.branch], w.path)
  let url: string
  try {
    url = exec('gh', ['pr', 'create', '--head', w.branch, '--title', `${w.key} ${w.ticket.title}`, '--body', w.ticket.url], w.path).split('\n').pop()!
  } catch (e) {
    const existing = /https:\/\/\S+\/pull\/\d+/.exec(String((e as any).stderr ?? (e as Error).message))
    if (!existing) throw e
    url = existing[0] // already has a PR: pushing updated it
  }
  await writeback(config, apiKey, w.key, 'pr').catch(() => {}) // the PR exists; a Linear hiccup shouldn't fail approve
  return url
}
