# Dash - Project Context & Guidelines

Dash is a desktop application designed to run **Claude Code** (and other CLI tools) across multiple projects and tasks concurrently. Each task operates within an isolated **git worktree**, preventing branch switching and conflict issues.

## 🏗️ Architecture & Tech Stack

- **Framework:** Electron (strict context isolation, contextBridge).
- **Frontend:** React 18, Tailwind CSS, Lucide React icons.
- **Backend (Main Process):** Node.js, SQLite with **Drizzle ORM** (better-sqlite3), **node-pty** for terminal emulation.
- **Terminal:** **xterm.js** in the renderer, managed by `ptyManager` in the main process.
- **Data Persistence:** SQLite database (`app.db`) and terminal snapshots stored in `~/Library/Application Support/Dash/`.

### Process Responsibilities

- **Main Process (`src/main`)**: Database services, Git operations, Worktree pooling, PTY management, Activity monitoring, and IPC handlers.
- **Renderer Process (`src/renderer`)**: React UI, Terminal state (xterm.js), Keybindings, and UI components.
- **Shared (`src/shared`)**: TypeScript interfaces and types used across both processes.

## 🚀 Key Commands

### Development

```bash
pnpm install       # Install dependencies
pnpm rebuild       # Rebuild native modules (node-pty, better-sqlite3)
pnpm dev           # Start Vite dev server and launch Electron
pnpm dev:main      # Restart only the main process
pnpm dev:renderer  # Start only the renderer dev server
```

### Build & Package

```bash
pnpm build               # Compile main (tsc) and renderer (vite)
pnpm package:mac         # Package as macOS .dmg (Apple Silicon & Intel)
./scripts/build-local.sh # Build, ad-hoc sign, and install to /Applications
```

### Database & Types

```bash
pnpm type-check       # Run tsc for both main and renderer
pnpm drizzle:generate # Generate SQL migrations from schema
```

## 🛠️ Development Conventions

### UI & Styling

- **Colors:** Use HSL CSS variables via Tailwind classes (e.g., `text-foreground`, `bg-surface-1`). Never use raw hex/rgb.
- **Components:**
  - Use `IconButton` for icon-only buttons (consistent hover/active states).
  - Use `Lucide React` for icons (default: 14px, 1.8 stroke-width).
  - Prefer pill-shaped buttons (`rounded-full`) for single-line actions and `rounded-lg` for block/modal buttons.
- **Theming:** Supports light/dark modes via `.light` / `.dark` classes on the root element.

### Git & Worktrees

- **Task Isolation:** Every task MUST have its own worktree and branch.
- **Worktree Pool:** A reserve of pre-created worktrees is maintained by `WorktreePoolService` for near-instant task startup.
- **Git Status:** Handled via `GitService` using porcelain v2 format.

### Database (SQLite + Drizzle)

- **Schema:** Defined in `src/main/db/schema.ts`.
- **Migrations:** Automated on startup via `src/main/db/migrate.ts`.
- **Service Pattern:** Database interactions should go through `DatabaseService`.

### IPC Communication

- **Strict Typing:** All IPC calls must be typed in `src/types/electron-api.d.ts` and use the `IpcResponse<T>` wrapper.
- **Pattern:** `renderer -> preload -> main IPC handler -> Service`.

## 📂 Key Files & Directories

- `src/main/services/`: Core business logic (Git, Worktree, PTY).
- `src/main/ipc/`: IPC request handlers.
- `src/renderer/components/`: UI components.
- `src/renderer/terminal/`: xterm.js integration and session management.
- `src/shared/types.ts`: Universal data models.
- `CLAUDE.md`: High-level technical reference and architecture map.
- `docs/STYLEGUIDE.md`: Detailed UI/UX conventions.

## ⚠️ Important Considerations

- **Native Modules:** `node-pty` and `better-sqlite3` are native. If you see errors about module versions, run `pnpm rebuild`.
- **Main Process Hot-Reload:** Unlike the renderer, changes to the main process require a restart of Electron (`pnpm dev:main`).
- **macOS Only:** The current build scripts and architecture (e.g., entitlements) are focused on macOS (Apple Silicon & Intel).

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
