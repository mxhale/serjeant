import { afterEach, expect, test, vi } from 'vitest'
import { fetchTickets, pickState, transition } from './linear.js'

const states = [
  { id: '1', name: 'Todo', type: 'unstarted' },
  { id: '2', name: 'In Progress', type: 'started' },
  { id: '3', name: 'In Review', type: 'started' },
]

afterEach(() => vi.unstubAllGlobals())

test('pickState prefers name over type, matches case-insensitively', () => {
  expect(pickState(states, 'in review')?.id).toBe('3')
  expect(pickState(states, 'started')?.id).toBe('2')
  expect(pickState(states, 'nope')).toBeUndefined()
})

test('transition looks up states then updates the issue', async () => {
  const calls: any[] = []
  vi.stubGlobal('fetch', async (_u: string, init: any) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const data = body.query.includes('mutation')
      ? { issueUpdate: { success: true } }
      : { issue: { id: 'uuid', team: { states: { nodes: states } } }, viewer: { id: 'me' } }
    return { ok: true, json: async () => ({ data }) }
  })
  expect(await transition('k', 'ENG-1', 'started', true)).toBe('In Progress')
  expect(calls[1].variables).toEqual({ id: 'uuid', input: { stateId: '2', assigneeId: 'me' } })
})

test('graphql errors surface as exceptions', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ errors: [{ message: 'bad key' }] }) }))
  await expect(fetchTickets('k', 'mine')).rejects.toThrow('bad key')
})
