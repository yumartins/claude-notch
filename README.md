# claude-notch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

macOS **menu bar** app that shows, at a glance, which AI coding agent sessions —
**Claude Code**, **Codex** and **Cursor** — are stalled waiting for you (permission
prompt or idle). Built with **Tauri v2** and a **React** frontend
(Vite + Tailwind + shadcn/ui on Base UI).

**Open source and free to use** — MIT licensed. Fork it, ship it, break it,
[contribute back](#contributing).

A discreet icon sits in the menu bar. When a session needs you, the icon lights up
amber with a count. Click it to open a dark, minimal popover listing your projects —
**click a project to jump straight to its terminal.**

```
menu bar:   …  ◯            (nothing pending)
            …  ● 2          (2 sessions waiting)

popover:
┌─────────────────────────────┐
│ Claude Code       2 waiting │
│─────────────────────────────│
│ ● adapter-lgpd      now     │
│   Waiting for permission    │
│ ● home-assistant    3min    │
│   Idle, waiting for you     │
│                      Quit   │
└─────────────────────────────┘
```

## Features

- **Multi-provider**: Claude Code, Codex CLI and Cursor sessions side by side, each
  with a provider badge. Integrations are installed per provider from Settings.
- **Session overview**: every session with live activity (current tool, e.g.
  `Bash · cargo build`), status dot (amber = waiting, green = running), age and
  working time.
- **Real approval over the hook socket**: Claude Code (`PermissionRequest`) and
  Cursor (`beforeShellExecution`/`beforeMCPExecution`) hooks block on a local unix
  socket while the popover shows Approve / Deny / answer-in-terminal. Fail-open by
  design: if the app isn't running, hooks exit instantly and nothing blocks.
- **Keystroke fallback for Claude Code**: without the socket hook installed, the
  popover focuses the session's terminal and sends the keystroke Claude Code
  expects (`1` / Esc). Needs the Accessibility permission.
- **Native notifications** when a session starts waiting for you.
- **Global shortcut**: `⌥⌘C` toggles the popover anywhere.
- **New session launcher**: the `+` button picks a folder and starts `claude` in a
  new Warp window.
- **Autostart** on login (packaged builds only).
- Footer shows app version + its own memory/CPU usage.

## How it works

1. Provider hooks write each session's state to a status file — Claude Code hooks
   (`Notification`, `Stop`, `UserPromptSubmit`, …) to
   `~/.claude/status/<session_id>.json`, Codex and Cursor hooks to
   `~/.claude-notch/status/` — including `tty` and `TERM_PROGRAM` for terminal
   focusing where available.
2. Permission-gating hooks (Claude Code `PermissionRequest`, Cursor
   `beforeShellExecution`/`beforeMCPExecution`) additionally connect to the app's
   unix socket at `~/.claude-notch/notch.sock` and block until you decide in the
   popover (or a timeout falls back to the provider's own prompt).
3. The Rust backend polls the status folders every ~1.5s, updates the menu bar icon
   (amber + count) and pushes the session list to the popover.
4. Clicking the icon toggles the popover, positioned right under it
   (via `tauri-plugin-positioner`); it hides itself when it loses focus.

### Clicking a project → focusing the terminal

Rust reads the session's `tty`/`TERM_PROGRAM` and runs an AppleScript via `osascript`:

- **Terminal.app** and **iTerm2**: matches the exact tab/pane by `tty` and brings it forward.
- **VS Code, Warp, Ghostty, WezTerm, kitty, Hyper, Tabby, Alacritty**: activates the app
  (best-effort — these don't expose tabs by tty via AppleScript).

> The first time you click, macOS asks for **Automation** permission
> (Settings → Privacy & Security → Automation). That's expected; just allow it.

## Project structure

```
src/                 React frontend (Vite + Tailwind + shadcn/ui + Base UI)
  components/        UI components (shadcn under components/ui)
  hooks/             React hooks (useSessions: listens to the "sessions" event)
  lib/               Pure session helpers (sorting, labels, relative time) + tests
src-tauri/           Rust backend (tray icon, status polling, terminal focus,
                     permission socket server, integration installer)
scripts/hooks/       Provider hook scripts (Claude Code, Codex, Cursor) + tests
```

## Installation

### 1. Prerequisites

- Rust (`https://rustup.rs`)
- [Bun](https://bun.sh)

### 2. Install the integrations

Open the popover → **Ajustes** → **Integrações** and click **Instalar** for each
agent you use. The app copies the hook scripts to `~/.claude-notch/hooks/` and
merges its entries into the agent's config (a one-time `.claude-notch.bak` backup
is kept next to each file it touches):

- **Claude Code** — `~/.claude/settings.json` (status hooks + `PermissionRequest`)
- **Codex** — `~/.codex/hooks.json` (+ enables `codex_hooks` in `~/.codex/config.toml`)
- **Cursor** — `~/.cursor/hooks.json`

**Remover** deletes only the entries containing `.claude-notch/hooks/`; everything
else in your config is left untouched. Hooks apply to new agent sessions.

Prefer doing it by hand for Claude Code? Copy `scripts/hooks/claude-status.py` (and
optionally `claude-permission.py` + `notch_ipc.py`) somewhere and merge
`scripts/claude-settings.example.json` into `~/.claude/settings.json`.

Test it: run Claude Code in some project, ask for something that requires permission,
then check `ls ~/.claude/status` — a `.json` file with `"status": "waiting"` and the
`tty` should appear.

### 3. Run the app

```bash
bun install
bun run dev
```

It opens no window: look for the icon (◯) in the menu bar, top right.

Final build:

```bash
bun run build
```

## Development

```bash
bun run lint        # Biome — lint + format check
bun run lint:fix    # fix everything
bun run typecheck   # tsc --noEmit
bun test            # session helper tests
```

## Visual signature

- **Menu bar:** template icon (ring) that becomes an **amber disc + count** when a
  session is waiting. A signal, not an alarm.
- **Popover:** near-black card (#0E0E12), system-ish type for the chrome and **mono**
  for project names (the vernacular of terminals). Status dot by color:
  amber = waiting, green = running, gray = idle. Respects `prefers-reduced-motion`.

## Known caveats

- **Transparency disappears in the packaged build (.dmg):** known Tauri bug on macOS.
  `macOSPrivateApi: true` is already on; if the window turns white after packaging,
  see Tauri issue #13415.
- **The `Notification` hook doesn't always fire on permission prompts** in some
  scenarios (open bug). The `idle_prompt` (60s idle) is the reliable fallback.
- **Automation:** terminal focusing needs the Automation permission (prompted on first click).
- **App icon:** `icons/icon.png` is a placeholder. Before the final build, generate the
  full set with `bun run tauri icon icons/icon.png`.

## Contributing

Contributions are welcome — bug reports, fixes, and features alike.

1. Fork the repo and create a branch (`git checkout -b my-fix`).
2. Make your change. Tests first (`bun test`) — TDD is how this repo rolls.
3. Make sure everything passes before opening the PR:

   ```bash
   bun run lint
   bun run typecheck
   bun test
   ```

4. Open a pull request describing **what** changed and **why**.

Found a bug or have an idea? [Open an issue](../../issues) — small, focused issues
get fixed fastest. See `CLAUDE.md` for the code style used throughout the project.

## License

[MIT](LICENSE) — free for personal and commercial use, no strings attached.
