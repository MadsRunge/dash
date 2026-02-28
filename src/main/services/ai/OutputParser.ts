export type ProviderState =
  | 'booting'
  | 'ready' // Prompt is available, ready for next command
  | 'streaming' // AI is generating a response
  | 'awaiting_input' // CLI asks user a question (e.g., y/n, continue)
  | 'auth_required'
  | 'error'
  | 'idle'
  | 'busy'
  | 'waiting';

export type OutputEvent =
  | { type: 'state'; state: ProviderState; reason?: string }
  | { type: 'meta'; key: string; value: string }
  | { type: 'noop' };

export interface OutputParser {
  /** Ingest raw PTY chunk (can include ANSI). Returns events. */
  ingest(chunk: string): OutputEvent[];
  /** Reset buffer between sessions */
  reset(): void;
  /**
   * Called when the user submits input (presses Enter).
   * Clears the accumulated buffer so patterns from the previous exchange
   * (e.g. y/n prompts) don't latch into the next interaction.
   */
  onUserInput(): void;
}

/**
 * Strips ANSI escape codes from a string.
 * This is a simple implementation sufficient for state parsing.
 */
function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Normalizes PTY output by stripping ANSI and converting carriage returns.
 */
export function normalizePtyOutput(input: string): string {
  return stripAnsi(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
