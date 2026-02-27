# Feature: Multi-AI Provider Support (Gemini, Codex, Claude)

## Problem Statement

Currently, Dash is tightly coupled to the `claude` CLI. Features like spawning, task context injection (`task-context.json`), and activity monitoring (HTTP hooks) are hardcoded in `ptyManager.ts`. To support Gemini and Codex, we need an abstraction layer.

## Architecture Strategy

We will implement an **Adapter Pattern**. Instead of `ptyManager` knowing _how_ to start Claude, it will ask an `AiProvider` interface to handle the specific setup, arguments, and activity tracking for the chosen CLI.

## Plan

### Phase 1: Abstraction & Refactoring (No new features yet)

- [x] **Step 1: Define `AiProvider` Interface**
  - Create `src/main/services/ai/AiProvider.ts` with methods like `getExecutablePath()`, `setupWorktreeContext()`, `getSpawnArgs()`, and `getActivityStrategy()`.
- [x] **Step 2: Implement `ClaudeProvider`**
  - Extract the existing `.claude` directory creation, `task-context.json` injection, and hook server configuration from `ptyManager.ts` into a new `ClaudeProvider` class.
- [x] **Step 3: Refactor `ptyManager.ts`**
  - Modify `spawnDirect` to accept an `AiProvider` instead of hardcoding Claude logic.
  - _Verification: Test that creating a standard Claude task still works flawlessly (No regressions)._

### Phase 2: User Interface & State

- [x] **Step 4: Database Schema Update**
  - Update `src/main/db/schema.ts` to add an `ai_provider` string column (defaulting to 'claude') to the `projects` and/or `tasks` table.
  - Run `pnpm drizzle:generate` to create the migration. (Note: Done via manual raw SQL in migrate.ts).
- [x] **Step 5: UI Settings & Task Creation**
  - Update `SettingsModal.tsx` to include an "AI Provider" section where users can set their default (Claude, Gemini, Codex) and configure paths if needed. (Note: Kept simple with localstorage for default).
  - Update `TaskModal.tsx` to include a dropdown to override the AI provider for a specific task.
  - Replace hardcoded Claude logos/text in the UI with dynamic provider names.

### Phase 3: Implement New Providers

- [x] **Step 6: Implement `GeminiProvider`**
  - Build the logic to locate the Gemini CLI.
  - Determine how to inject the initial task context (e.g., via CLI arguments or writing a specific config file the Gemini CLI reads).
  - Use CPU/process tree polling for activity monitoring if Gemini lacks HTTP hooks.
- [x] **Step 7: Implement `CodexProvider` (Generic OpenAI / Copilot CLI)**
  - Similar to Gemini, implement the spawn and context injection logic for the chosen Codex/OpenAI terminal client.

## Review & Verification

- Ensure seamless backwards compatibility with Claude.
- Verify that a Gemini task spawns in its own worktree and receives the prompt.
- Confirm activity indicators (busy/idle) function correctly across different providers.
