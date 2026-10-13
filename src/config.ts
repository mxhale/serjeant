import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'smol-toml'
import { z } from 'zod'
import type { Ticket } from './linear.js'

export const configPath = () =>
  process.env.SERJEANT_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'serjeant', 'config.toml')

const Macro = z.object({
  mode: z.enum(['headless', 'handoff']),
  prompt: z.string().min(1),
  flags: z.array(z.string()).default([]),
})
export type Macro = z.infer<typeof Macro>

const Schema = z.object({
  linear_api_key: z.string().optional(),
  repos: z.record(z.string(), z.string()).default({}),
  teams: z
    .record(
      z.string(),
      z.object({
        repo: z.string().optional(),
        default_macro: z.string().optional(),
        labels: z.record(z.string(), z.string()).default({}), // label -> repo name
      }),
    )
    .default({}),
  macros: z.record(z.string(), Macro).default({}),
  writeback: z
    .object({
      on_start: z.string().optional(), // Linear state type or name
      on_pr: z.string().optional(),
      assign_on_start: z.boolean().default(false),
    })
    .default({ assign_on_start: false }),
})
export type Config = z.infer<typeof Schema>

// Always available, overridable by the user's config.
export const BUILTIN_MACROS: Record<string, Macro> = {
  implement: {
    mode: 'headless',
    flags: ['--permission-mode', 'acceptEdits'],
    prompt: 'Implement {{ticket.key}}: {{ticket.title}}\n\n{{ticket.body}}\n\nRun the tests. Commit when green.',
  },
  plan: {
    mode: 'handoff',
    flags: ['--permission-mode', 'plan'],
    prompt: 'Plan {{ticket.key}}: {{ticket.title}}\n\n{{ticket.body}}',
  },
}

export const TEMPLATE = `# serjeant config
# linear_api_key = "lin_api_..."   # or set LINEAR_API_KEY

[repos]
# name = "/path/to/repo"

[teams.ENG]
# repo = "name"
# default_macro = "implement"
# labels = { frontend = "web" }   # label -> repo name

# Built-in macros "implement" (headless) and "plan" (handoff) can be overridden here.
# [macros.quick]
# mode = "headless"                 # headless | handoff
# flags = ["--permission-mode", "acceptEdits"]
# prompt = "Do {{ticket.key}}: {{ticket.title}}\\n{{ticket.body}}"

[writeback]
# on_start = "started"              # Linear state type or name
# on_pr = "In Review"
# assign_on_start = true
`

export type Loaded = { config: Config; error?: string }

export const defaults = (): Config => Schema.parse({})

// Never throws: a broken config yields defaults plus an error to show in the status bar.
export function loadConfig(path = configPath()): Loaded {
  if (!existsSync(path)) return { config: defaults() }
  try {
    const parsed = Schema.safeParse(parse(readFileSync(path, 'utf8')))
    if (parsed.success) return { config: parsed.data }
    const i = parsed.error.issues[0]
    return { config: defaults(), error: `config: ${i.path.join('.') || '(root)'}: ${i.message}` }
  } catch (e) {
    return { config: defaults(), error: `config: ${(e as Error).message.split('\n')[0]}` }
  }
}

export function ensureConfigFile(path = configPath()) {
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, TEMPLATE)
}

export const macros = (c: Config): Record<string, Macro> => ({ ...BUILTIN_MACROS, ...c.macros })

const expand = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p)

// Label mapping wins over the team default; undefined means "ask the user".
export function resolveRepo(c: Config, t: Ticket): { name: string; path: string } | undefined {
  const team = c.teams[t.team]
  const name = t.labels.map(l => team?.labels[l]).find(Boolean) ?? team?.repo
  return name && c.repos[name] ? { name, path: expand(c.repos[name]) } : undefined
}

export const repoPath = (c: Config, name: string) => (c.repos[name] ? expand(c.repos[name]) : undefined)
