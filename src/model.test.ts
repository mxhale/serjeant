import { expect, test } from 'vitest'
import { DEMO } from './linear.js'
import { fuzzy, toRows } from './model.js'

test('fuzzy is an ordered subsequence match', () => {
  expect(fuzzy('abt', 'auth bug test')).toBe(true)
  expect(fuzzy('tba', 'auth bug test')).toBe(false)
})

test('rows group by state, started first, filters narrow', () => {
  const rows = toRows(DEMO, '')
  expect(rows[0]).toEqual({ type: 'header', label: 'In Progress' })
  expect(rows.filter(r => r.type === 'header').map(r => (r as any).label)).toEqual(['In Progress', 'Todo', 'Backlog'])
  expect(toRows(DEMO, 'pricing').filter(r => r.type === 'ticket')).toHaveLength(1)
  expect(toRows(DEMO, '', 'WEB').filter(r => r.type === 'ticket')).toHaveLength(1)
  expect(toRows(DEMO, '', undefined, 'bug').filter(r => r.type === 'ticket')).toHaveLength(1)
})
