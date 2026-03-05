# AGENTS.md

## Cursor Cloud specific instructions

This is a **pnpm monorepo** (Node.js 22+, pnpm 10.23+) with two workspace members: the root CLI (`denchclaw`) and `apps/web` (Next.js 15 web UI on port 3100).

### Quick reference

| Action | Command |
|---|---|
| Install deps | `pnpm install` |
| Build CLI | `pnpm build` |
| Dev web UI | `pnpm web:dev` (port 3100) |
| Run CLI | `pnpm dev` |
| Lint | `pnpm lint` (oxlint with type-aware mode) |
| Format check | `pnpm format:check` (oxfmt) |
| All tests | `pnpm test` (Vitest — CLI + web) |
| CLI tests only | `pnpm test:cli` |
| Web tests only | `pnpm test:web` |

### Non-obvious notes

- **Pre-existing lint/format issues**: The repo has pre-existing `oxfmt` format violations and `oxlint` curly-brace warnings. `pnpm check` (which runs `format:check && lint`) will exit non-zero. Run `pnpm lint` or `pnpm format:check` individually to distinguish formatting from lint errors.
- **AI chat requires OpenClaw gateway**: The chat feature connects to an OpenClaw WebSocket gateway. Without `openclaw` installed and its gateway running, sending chat messages will show "Gateway WebSocket connection failed". This is expected in cloud agent environments — the web UI itself is fully functional for development and testing without it.
- **`pnpm install` warning about ignored build scripts**: pnpm may warn about ignored build scripts for `@discordjs/opus`, `core-js`, `koffi`, `unicode-animations`. The `pnpm-workspace.yaml` already has `onlyBuiltDependencies` configured; no action needed.
- **Build before `pnpm dev`**: The CLI entry (`denchclaw.mjs`) imports from `dist/`, so you must `pnpm build` before running `pnpm dev`. The web dev server (`pnpm web:dev`) does not need a prior build.
