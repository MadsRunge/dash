# Hardening the AI Orchestrator Layer

## Goal

Implement prompt guarding, state hysteresis (debounce/stability), and config-driven parsing based on architectural review.

## Plan

### Step 1: Prompt Guard & Context Formatting

- [x] Create a central `PromptFormatter` utility (e.g., in `src/main/services/ai/PromptFormatter.ts`).
- [x] Implement a method that wraps the user prompt and linked issues inside a strict `CONTEXT (read-only reference)` block.
- [x] Update `GeminiProvider` and `CodexProvider` to use this formatter when writing `prompt.txt`.

### Step 2: Config-Driven Generic Parser (DSL)

- [x] Create `GenericOutputParser.ts` that accepts a regex config (`promptPattern`, `authPattern`, `errorPattern`, etc.).
- [x] Refactor `GeminiOutputParser` to be an instance of `GenericOutputParser` initialized with Gemini's specific patterns.
- [x] Instantiate `GenericOutputParser` for `CodexProvider` with Codex-specific (or dummy) patterns.

### Step 3: State Hysteresis (Activity Monitor)

- [x] Review `ActivityMonitor.ts` `forceState` implementation.
- [x] Ensure `setTimeout` logic for `ready` transitions correctly implements hysteresis (preventing bouncing between `streaming` and `ready`).
- [x] Ensure `STABLE_STATES` (error, auth_required) lock the state permanently until a specific reset is called.
