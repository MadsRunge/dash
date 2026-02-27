# Implement CLI Output Parser Strategy

## Goal

Implement the "Controller Pattern" described in `docs/CLI_PARSER_STRATEGY.md` to accurately detect the activity state (booting, ready, streaming, awaiting_input, auth_required, error) of CLI tools that lack HTTP hooks (like Gemini and Codex).

## Plan

### Step 1: Define the Interfaces and Helpers

- [x] Create `src/main/services/ai/OutputParser.ts` defining `OutputParser`, `ProviderState`, and `OutputEvent`.
- [x] Add the `stripAnsi` and `normalizePtyOutput` helper functions to this file.
- [x] Update `AiProvider.ts` to include `getOutputParser?(): OutputParser`.

### Step 2: Implement the GeminiParser

- [x] Create `src/main/services/ai/GeminiOutputParser.ts` implementing `OutputParser`.
- [x] Use a rolling buffer (clamped to ~8000 chars) and the regex patterns suggested in the strategy (Auth, Error, Awaiting, Ready prompt).
- [x] Update `GeminiProvider.ts` to instantiate and return this parser.

### Step 3: Wire into `ptyManager.ts`

- [x] Modify the `proc.onData` handler in `startDirectPty` to feed chunks to `provider.getOutputParser()?.ingest(chunk)`.
- [x] Loop over resulting `OutputEvent`s.
- [x] For state events, update the `activityMonitor` via `activityMonitor.forceState(options.id, ev.state, ev.reason)`.

### Step 4: Update ActivityMonitor

- [x] Update `ActivityMonitor.ts` to support the new fine-grained states (booting, ready, streaming, awaiting_input, auth_required, error).
- [x] Implement debouncing for the 'ready' state to prevent UI flicker from spinners.
- [x] Add `forceState` method if it doesn't already exist to handle these explicit event updates.
- [x] Ensure IPC events carry the reason text.

### Step 5: Update the UI (Renderer)

- [x] Update `src/renderer/components/LeftSidebar.tsx` or where activity indicators are drawn to handle the new states (e.g., specific colors for auth_required or error).

## Verification

- Test that creating a Gemini task shows 'booting', transitions to 'streaming' when output starts, and settles at 'ready' when the `> ` prompt appears.
- Intentionally trigger an error or auth prompt to verify those states are latched.
