# serjeant

Vim-keyed terminal UI that connects Linear to your code:
browse issues, start work in a git worktree with a Claude run, review the diff, ship a PR.

```
pnpm install && pnpm build
LINEAR_API_KEY=lin_api_... node dist/cli.js      # or: pnpm dev
pnpm demo                                        # fixture data, no Linear
```

Needs `git` and `claude` on PATH; `nvim` for the editor handoff (override with `SERJEANT_EDITOR`), `gh` for PRs.

## Keys

| Screen | Keys |
|---|---|
| Explorer | `j k gg G ^d ^u` move, `/` fuzzy filter, `:` command, `r` refresh, `s`/`Enter` start work or open run, `e` nvim in worktree, `c` interactive claude, `R` review, `Esc` clear filters, `q` quit |
| Commands | `:team ENG` `:label bug` `:all` `:mine` `:clear` `:config` `:done` `:done!` `:q` |
| Run | `a`/`x` allow/deny a permission prompt, `i` reply to the agent, `j k gg G` scroll, `e` `c` handoff, `R` review, `q` back |
| Review | `j k gg G` `]`/`[` hunk, `n`/`N` file, `m` viewed, `c` comment line, `V` range, `x` delete, `Z` send comments to the agent, `a` approve (push + PR), `q` back |

Status badges in the list: `⎇` worktree, `●` working, `!` needs permission, `?` agent asked a question, `✓` done, `✗` failed, `⏸` interrupted, `⚑` worktree left over for a closed ticket.

## Config

`~/.config/serjeant/config.toml` (`:config` opens it in your editor and creates a template; errors show in the status bar).

```toml
[repos]
api = "~/code/api"
web = "~/code/web"

[teams.ENG]
repo = "api"
default_macro = "implement"
[teams.ENG.labels]
frontend = "web"            # label -> repo

[macros.quick]
mode = "headless"           # headless: serjeant runs claude and shows the stream
                            # handoff:  serjeant steps aside and gives you interactive claude
flags = ["--permission-mode", "acceptEdits"]
prompt = "Do {{ticket.key}}: {{ticket.title}}\n{{ticket.body}}"

[writeback]                 # all optional; Linear state name or type
on_start = "started"
on_pr = "In Review"
assign_on_start = true
```

Built-in macros: `implement` (headless, acceptEdits) and `plan` (handoff, plan mode). Template vars: `{{ticket.key}}`, `{{ticket.title}}`, `{{ticket.body}}`, `{{ticket.url}}`, `{{branch}}`.

## How it works

- Worktrees live at `<repo>/../.serjeant-worktrees/<repo>/<KEY>` on the ticket's Linear branch.
- Headless runs use `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`: permission requests become prompts in the UI, and when the agent ends a turn with a question you answer it with `i`. Runs die with serjeant; reopening shows the logged transcript and your next message resumes the session.
- State (issue cache, worktrees, sessions, review comments) is in `~/.local/state/serjeant`.
