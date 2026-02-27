# CLI Output Parsing Strategy (The "Controller" Pattern)

When wrapping CLIs that don't provide explicit HTTP hooks (like Claude Code does), Dash acts as a "Controller" by analyzing the raw PTY stream to infer the AI's state. This allows the UI to show accurate activity indicators (busy, idle, error).

## Core Principles for Robust Parsing

1.  **Rolling Buffers:** `onData` chunks arrive arbitrarily. A prompt like `gemini> ` might be split across two chunks. Parsers MUST use a rolling buffer to evaluate state, not just the latest chunk.
2.  **Normalization:** CLIs output ANSI escape codes (colors, cursor movements), carriage returns (`
`), and spinners. All incoming chunks must be normalized (stripped of ANSI) before regex evaluation.
3.  **Granular States:** Simple "idle/busy" is insufficient. A robust state machine should support: `booting`, `ready` (awaiting input), `streaming` (generating output), `awaiting_input` (CLI asks a y/n question), `auth_required`, and `error`.
4.  **Debouncing:** Transitions to "ready" should be slightly debounced to prevent UI flickering from fast spinners or clearing routines. Latch "auth_required" and "error" states until explicitly reset.

## Architectural Implementation (Planned)

### 1. The OutputParser Interface

```typescript
export type ProviderState =
  | 'booting'
  | 'ready' // Prompt is available, ready for next command
  | 'streaming' // AI is generating a response
  | 'awaiting_input' // CLI asks user a question (e.g., y/n, continue)
  | 'auth_required'
  | 'error';

export type OutputEvent =
  | { type: 'state'; state: ProviderState; reason?: string }
  | { type: 'meta'; key: string; value: string }
  | { type: 'noop' };

export interface OutputParser {
  /** Ingest raw PTY chunk (can include ANSI). Returns events. */
  ingest(chunk: string): OutputEvent[];
  /** Reset buffer between sessions */
  reset(): void;
}
```

### 2. Provider Integration

The `AiProvider` interface will be extended to optionally expose an `OutputParser`:

```typescript
export interface AiProvider {
  // ... existing methods ...
  getOutputParser?(): OutputParser;
}
```

In `ptyManager.ts`, the `onData` handler will feed chunks to this parser (if available) and dispatch the resulting `OutputEvent`s to the `ActivityMonitor`.

### 3. Normalization Helper

```typescript
function stripAnsi(input: string) {
  // Simple ANSI stripper suitable for state parsing
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function normalizePtyOutput(input: string) {
  return stripAnsi(input).replace(/
/g, '
').replace(/
/g, '
');
}
```

### 4. Controller Logic (Future)

Once parsing is stable, Dash can move beyond simple injection via `-i` and proactively feed structured prompts (`SYSTEM`, `TASK`, `CONTEXT`) when the parser detects the `ready` state, effectively driving the CLI as a programmatic agent.
