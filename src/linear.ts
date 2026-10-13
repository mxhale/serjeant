export type Ticket = {
  key: string
  title: string
  body: string
  branch: string
  url: string
  team: string
  state: string
  stateType: string
  labels: string[]
  assignee: string | null
}

const FIELDS = `identifier title description branchName url
  state { name type } team { key } labels { nodes { name } } assignee { name }`

const NOT_DONE = `{ state: { type: { nin: ["completed", "canceled"] } } }`

const QUERY = {
  mine: `{ viewer { assignedIssues(first: 100, filter: ${NOT_DONE}) { nodes { ${FIELDS} } } } }`,
  all: `{ issues(first: 100, filter: ${NOT_DONE}) { nodes { ${FIELDS} } } }`,
}

export async function fetchTickets(apiKey: string, scope: 'mine' | 'all'): Promise<Ticket[]> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query: QUERY[scope] }),
  })
  const json = (await res.json()) as any
  if (!res.ok || json.errors) {
    throw new Error(json.errors?.[0]?.message ?? `Linear HTTP ${res.status}`)
  }
  const nodes = (scope === 'mine' ? json.data.viewer.assignedIssues : json.data.issues).nodes
  return nodes.map((n: any): Ticket => ({
    key: n.identifier,
    title: n.title,
    body: n.description ?? '',
    branch: n.branchName,
    url: n.url,
    team: n.team.key,
    state: n.state.name,
    stateType: n.state.type,
    labels: n.labels.nodes.map((l: any) => l.name),
    assignee: n.assignee?.name ?? null,
  }))
}

export const DEMO: Ticket[] = [
  ['ENG-123', 'Add retry option to config', 'started', 'In Progress', ['config'], 'We need a `retries` option.\n\n- default 3\n- exponential backoff\n- read from env `SERJEANT_RETRIES`'],
  ['ENG-140', 'Auth refactor', 'unstarted', 'Todo', ['backend', 'tech-debt'], 'Split session handling out of the auth middleware.'],
  ['ENG-151', 'Bump dependencies', 'unstarted', 'Todo', ['chore'], 'Run the usual bump, fix what breaks.'],
  ['ENG-160', 'Dark mode for settings page', 'backlog', 'Backlog', ['frontend'], ''],
  ['WEB-12', 'Fix typo on pricing page', 'unstarted', 'Todo', ['frontend', 'bug'], 'Pricing page says "recieve".'],
].map(([key, title, stateType, state, labels, body]) => ({
  key: key as string,
  title: title as string,
  body: body as string,
  branch: `max/${(key as string).toLowerCase()}`,
  url: `https://linear.app/demo/issue/${key}`,
  team: (key as string).split('-')[0],
  state: state as string,
  stateType: stateType as string,
  labels: labels as string[],
  assignee: 'Max',
}))
