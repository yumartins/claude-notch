# claude-notch

macOS menu bar app (Tauri v2 + React) that shows which Claude Code sessions are
waiting for you. Rust backend polls `~/.claude/status/*.json`; React popover UI.

## Language

Everything in **English** — code, comments, docs, commit messages, variable names, **file names, and component names**. This includes section components, illustrations, and any other files in the codebase. User-facing UI copy is in English too.

## Code Style

**No if/else.** Use early return, optional chaining, nullish coalescing, ternary, or lookup objects.

```ts
// ✗
function getLabel(plan: string) {
  if (plan === "squads") {
    return "Squads"
  } else if (plan === "build") {
    return "Build"
  } else {
    return "Studio"
  }
}

// ✓
enum Plan {
  Squads = "squads",
  Build = "build",
  Studio = "studio",
}

const PLAN_LABELS: Record<Plan, string> = {
  [Plan.Squads]: "Squads",
  [Plan.Build]: "Build",
  [Plan.Studio]: "Studio",
}

interface GetLabelParams {
  plan: Plan
}

function getLabel({ plan }: GetLabelParams) {
  return PLAN_LABELS[plan] ?? "Studio"
}
```

**Functions always with `function` keyword, always with named parameters.**

```ts
// ✗
const submit = (data, id) => { ... }

// ✓
interface SubmitParams {
  data: FormData
  id: string
}

function submit({ data, id }: SubmitParams) { ... }
```

**Interfaces at the top of the file**, before any function or component. Never inline type shapes in function parameters.

**Prefer enums** over string literals when the values form a known, finite set.

**Clean code. Small, readable functions.** If a function needs a comment to explain what it does, rename it. If it needs to explain why, write the comment.

**Comments only when necessary** — hidden constraints, non-obvious invariants, or workarounds. Never explain what the code does.

**Reuse before creating.** Before writing anything new, check if it already exists in the codebase. If the same logic appears in more than one or two places, extract it into a shared module and import it — never copy-paste.

## CSS

**Avoid arbitrary values.** Always prefer Tailwind's design tokens over custom bracket classes:

```tsx
// ✗
<p className="text-[14px] mt-[8px]">

// ✓
<p className="text-sm mt-2">
```

Reach for arbitrary values only when no token exists for the exact requirement.

## Testing — TDD is Non-Negotiable

Write the test first, watch it fail, then implement. No exceptions.

- **Always test the core of the requested feature** — the behavior the user asked for, not incidental details.
- **Avoid mocks as much as possible.** Never mock code that exists in this codebase or platform built-ins — exercise the real thing.
- Mock only true external boundaries: third-party libs, external APIs, network calls.
- **Bug fixes**: apply the fix, then add a regression test that would have caught the bug.
- Test runner: `bun test`.

## Guidelines (`docs/guidelines/`)

Living reference for claude-notch product and design decisions. Read before making product, design, or communication choices (create the files as decisions accumulate):

- `docs/guidelines/brand.md` — voice, tone, positioning, copy rules
- `docs/guidelines/design-system.md` — colors, typography, visual direction

## Dependencies

Always install the latest version; never pin a specific version:

```bash
# ✓
bun add react

# ✗
bun add react@18.2.0
```

## Definition of Done

Every implementation is only complete after running these checks and confirming they all pass:

```bash
bun run lint        # Biome — must have zero errors
bun run typecheck   # tsc --noEmit — must have zero errors
bun test            # must pass
```

Never report a task as done if any of them fail.

## Tooling

**Biome** for lint and format. No eslint, prettier, or other formatters.

```bash
bun run lint        # lint + format check
bun run lint:fix    # fix everything
```

## Bun-First

Always prefer **Bun's built-in services and APIs** over third-party packages when an equivalent exists. Reach for npm libraries only when Bun has no native option.

| Use case | Bun API | Avoid |
|---|---|---|
| SQL (Postgres/MySQL/SQLite) | `bun:sql` (`import { sql } from "bun"`) | `pg`, `postgres`, `mysql2`, Drizzle/Kysely as a runtime client |
| File I/O | `Bun.file`, `Bun.write` | `fs/promises` |
| Password | `Bun.password` | `bcrypt`, `argon2` |
| Shell commands | `Bun.$` | `execa`, `zx` |
| Subprocesses | `Bun.spawn` | `child_process` |
| S3 | `Bun.s3` | `@aws-sdk/client-s3` |
| Redis | `Bun.redis` | `ioredis`, `redis` |
| HTTP client | `fetch` (native) | `axios`, `got` |
| Test runner | `bun test` | `vitest`, `jest` |
| Env vars | `Bun.env` / `process.env` (Bun loads `.env` automatically) | `dotenv` |

Schema-generation tools that emit raw SQL (e.g. Drizzle Kit for migrations) are fine — the runtime still uses `bun:sql`.
