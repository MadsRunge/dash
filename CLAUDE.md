# CLAUDE.md

## What is Dash

Electron desktop app for running Claude Code across multiple projects, each task in its own git worktree. xterm.js + node-pty terminals, SQLite + Drizzle ORM, React 18 UI. macOS only (Apple Silicon & Intel).

## Commands

```bash
pnpm install              # install deps
pnpm rebuild              # rebuild native modules (node-pty, better-sqlite3)
pnpm dev                  # Vite on :3000 + Electron
pnpm dev:main             # main process only
pnpm dev:renderer         # Vite dev server only
pnpm build                # compile main (tsc) + renderer (vite)
pnpm type-check           # typecheck both processes
pnpm package:mac          # build + package as .dmg (Apple Silicon & Intel)
pnpm drizzle:generate     # generate Drizzle migrations
./scripts/build-local.sh  # build, sign, install to /Applications
```

Renderer hot-reloads; main process changes require restart. Husky pre-commit runs lint-staged (Prettier + ESLint on staged `.ts`/`.tsx`).

## Architecture

Two-process Electron app, strict context isolation (nodeIntegration disabled).

**Main** (`src/main/`): `entry.ts` → `main.ts` boots PATH fix, DB, hook server, IPC handlers, activity monitor, window.

**Renderer** (`src/renderer/`): React SPA, all state in `App.tsx` (~930 lines, no Redux). Communicates via `window.electronAPI` (preload bridge, typed in `src/types/electron-api.d.ts`).

**IPC**: `electronAPI.method()` → `ipcRenderer.invoke()` → handler in `src/main/ipc/` → `IpcResponse<T>` `{ success, data?, error? }`. Fire-and-forget via `send()` for ptyInput/resize/kill/snapshot-save.

### Services (`src/main/services/`)

Stateless singletons with static methods:

| Service                   | Purpose                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DatabaseService`         | CRUD projects/tasks/conversations, upsert pattern, cascade deletes, linkedIssues as JSON                                                                    |
| `WorktreePoolService`     | Pre-creates reserve worktrees (<100ms task start). 30min expiry. Claims via `git worktree move` + `branch -m`                                               |
| `WorktreeService`         | Create/remove worktrees, resolve base refs, copy preserved files (.env, .envrc, docker-compose.override.yml). Branch: `{slug}-{3char-hash}`                 |
| `ptyManager`              | Two spawn paths: direct Claude CLI (bypasses shell, minimal env) and shell (fallback). Configures `.claude/settings.local.json` hooks. Reattaches on reload |
| `TerminalSnapshotService` | Persist terminal state to disk (8MB/snapshot, 64MB cap) at `~/Library/Application Support/Dash/terminal-snapshots/`                                         |
| `GitService`              | Status (porcelain v2), diff parsing into hunks/lines, stage/unstage/commit/push. 15s timeout, 1MB max diff. Filters `.claude/*`                             |
| `GithubService`           | `gh` CLI: issue search, branch linking via GraphQL, post branch comments. 15s timeout                                                                       |
| `HookServer`              | HTTP on `127.0.0.1:{random}`. `/hook/stop` → idle + notification, `/hook/busy` → busy. Click-to-focus                                                       |
| `ActivityMonitor`         | PTY busy/idle tracking. Direct spawns: hook-driven. Shell spawns: poll process tree (2s). Broadcasts `pty:activity`                                         |
| `FileWatcherService`      | Recursive `fs.watch`, 500ms debounce, ignores node_modules/.git. Sends `git:fileChanged`                                                                    |

### IPC Handlers (`src/main/ipc/`)

| File          | Handles                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `appIpc`      | Version, dialogs, openExternal, git/Claude detection, notification toggle                         |
| `dbIpc`       | CRUD projects/tasks/conversations, archive/restore                                                |
| `gitIpc`      | Status, diff, stage/unstage, discard, commit, push, branches, file watcher, clone                 |
| `ptyIpc`      | PTY start (direct+shell), input/resize/kill, snapshots, session detection, task context, activity |
| `worktreeIpc` | Create, remove, claim/ensure/check reserve                                                        |
| `githubIpc`   | Check availability, search issues, get issue, branch comment, link branch                         |

### Database (`src/main/db/`)

SQLite via better-sqlite3 + Drizzle ORM. WAL mode, 5s busy timeout, foreign keys ON. DB at `~/Library/Application Support/Dash/app.db`. Migrations run on startup.

**Tables** (cascade deletes: projects → tasks → conversations):

- `projects`: id, name, path (unique), git_remote, git_branch, base_ref, timestamps
- `tasks`: id, project_id (FK), name, branch, path, status, use_worktree, auto_approve, linked_issues (JSON), archived_at, timestamps
- `conversations`: id, task_id (FK), title, is_active, is_main, display_order, timestamps

### Renderer (`src/renderer/`)

**Layout** — 3-panel via `react-resizable-panels`:

- `LeftSidebar` — projects + nested tasks, activity indicators (busy=amber, idle=green)
- `MainContent` — task header (name, branch, linked issues) + `TerminalPane`
- `FileChangesPanel` — staged/unstaged files, per-file actions, commit/push

**Terminal** (`terminal/`): `TerminalSessionManager` (~640 lines) manages xterm.js lifecycle, addons (Fit, Serialize, WebLinks, WebGL/Canvas fallback), snapshot save/restore (10s debounce), session restart overlay, Shift+Enter → Ctrl+J. `SessionRegistry` singleton prevents duplicates, coordinates themes, batch saves on quit.

**Modals**: `TaskModal` (name, worktree, base branch, issue picker, yolo mode) · `AddProjectModal` (folder or clone) · `DeleteTaskModal` (cleanup options) · `SettingsModal` (General/Keybindings/Connections tabs) · `DiffViewer` (line selection, inline comments → terminal)

**UI**: `IconButton` (default/destructive, sm/md) · `CircleCheck` (custom checkbox) · `Toast` (sonner wrapper)

**Utils**: `keybindings.ts` (defaults, load/save, matching) · `sounds.ts` (chime/cash/ping/droplet/marimba)

### Shared Types (`src/shared/types.ts`)

`Project`, `Task`, `Conversation`, `IpcResponse<T>`, `WorktreeInfo`, `ReserveWorktree`, `RemoveWorktreeOptions`, `PtyOptions`, `TerminalSnapshot`, `BranchInfo`, `FileChange`, `GitStatus`, `DiffResult`, `DiffHunk`, `DiffLine`, `GithubIssue`

## Path Aliases

- `@/*` → `src/renderer/*` (renderer tsconfig) or `src/main/*` (main tsconfig)
- `@shared/*` → `src/shared/*` (both tsconfigs)

Main process `entry.ts` rewrites at runtime: `@shared/*` → `dist/main/shared/*`, `@/*` → `dist/main/main/*`.

## Code Style

- **Prettier**: 2 spaces, single quotes, semicolons, trailing commas, 100-char width
- **ESLint**: `no-explicit-any` warn; `_` prefix unused vars allowed; `no-require-imports` off
- **Tailwind CSS** for all styling; dark/light via class on root
- **Colors**: HSL CSS custom properties only (no raw hex/rgb). Tokens: `foreground`, `muted-foreground`, `background`, `surface-0..3`, `primary`, `destructive`, `border`, `git-added/modified/deleted/renamed/untracked/conflicted`
- **Icons**: lucide-react, 14px default, stroke-width 1.8
- See [docs/STYLEGUIDE.md](./docs/STYLEGUIDE.md) for full conventions

## Key Libraries

Electron 30, React 18, xterm.js 5 (fit/serialize/web-links/webgl/canvas addons), better-sqlite3 + drizzle-orm, Tailwind CSS 3, lucide-react, react-resizable-panels, sonner, @radix-ui (dialog/dropdown-menu/tooltip), clsx, tailwind-merge, class-variance-authority, Vite 5, TypeScript 5, electron-builder, ESLint 8, Prettier 3, Husky 9 + lint-staged.

## Data Storage

- **DB**: `~/Library/Application Support/Dash/app.db`
- **Snapshots**: `~/Library/Application Support/Dash/terminal-snapshots/`
- **Worktrees**: `{projectPath}/../worktrees/{task-slug}/`
- **UI state**: localStorage (active project/task, theme, keybindings, panel states, notification prefs)

## CI/CD

GitHub Actions (`.github/workflows/build.yml`): triggers on `v*` tags + manual dispatch. Builds macOS DMG/ZIP, creates GitHub release.

## Requirements

Node.js 22+ (`.nvmrc`), pnpm (`shamefully-hoist` in `.npmrc`), Claude Code CLI, Git, macOS.

# Workflow Orchestration

## #1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don’t keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## #2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## #3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

## #4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: “Would a staff engineer approve this?”
- Run tests, check logs, demonstrate correctness

## #5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask “is there a more elegant way?”
- If a fix feels hacky: “Knowing everything I know now, implement the elegant solution”
- Skip this for simple, obvious fixes — don’t over-engineer
- Challenge your own work before presenting it

## #6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don’t ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

# Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check plan in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

# Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what’s necessary. Avoid introducing bugs.
