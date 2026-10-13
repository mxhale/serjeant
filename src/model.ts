import type { Ticket } from './linear.js'

// Linear state types in workflow order.
const ORDER = ['started', 'unstarted', 'triage', 'backlog']

export type Row = { type: 'header'; label: string } | { type: 'ticket'; ticket: Ticket }

// fzf-style subsequence match: every char of q appears in s, in order.
export const fuzzy = (q: string, s: string) => {
  let i = 0
  for (const c of s.toLowerCase()) if (c === q[i]?.toLowerCase()) i++
  return i === q.length
}

export const matches = (t: Ticket, q: string) =>
  fuzzy(q, `${t.key} ${t.title} ${t.labels.join(' ')}`)

export function toRows(tickets: Ticket[], filter: string, team?: string, label?: string): Row[] {
  const shown = tickets.filter(
    t => (!filter || matches(t, filter)) && (!team || t.team === team) && (!label || t.labels.includes(label)),
  )
  const rank = (t: Ticket) => {
    const i = ORDER.indexOf(t.stateType)
    return i < 0 ? ORDER.length : i
  }
  shown.sort((a, b) => rank(a) - rank(b) || a.state.localeCompare(b.state) || a.key.localeCompare(b.key, undefined, { numeric: true }))
  const rows: Row[] = []
  let last = ''
  for (const t of shown) {
    if (t.state !== last) rows.push({ type: 'header', label: (last = t.state) })
    rows.push({ type: 'ticket', ticket: t })
  }
  return rows
}
