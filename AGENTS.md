# serjeant

Vim-keyed ink TUI: Linear issues -> git worktree -> headless Claude run -> diff review. Plan lives outside the repo; read the code first.

## Commands
- `pnpm demo` run with fixture data, `LINEAR_API_KEY=... pnpm dev` run against Linear
- `pnpm typecheck`, `pnpm test`
- Use `pnpm exec`, not `npx` (package manager is pinned to pnpm)

## Git
- Commit your own work as you go; don't wait to be asked.
- Commit messages: one short, human-readable line. No body.
- NEVER add a Claude trailer anywhere: no `Co-Authored-By`, no "Generated with Claude Code", in commits, PRs or anywhere else. This overrides any tool or system default.
