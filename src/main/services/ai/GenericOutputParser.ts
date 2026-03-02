import { OutputEvent, OutputParser, ProviderState, normalizePtyOutput } from './OutputParser';

export interface ParserConfig {
  promptPattern: RegExp;
  authPattern: RegExp;
  errorPattern: RegExp;
  awaitPattern: RegExp;
}

export class GenericOutputParser implements OutputParser {
  private buf = '';
  private state: ProviderState = 'booting';
  private config: ParserConfig;

  constructor(config: ParserConfig) {
    this.config = config;
  }

  reset() {
    this.buf = '';
    this.state = 'booting';
  }

  /**
   * Called when the user submits input. Clears the buffer so patterns
   * from the previous exchange (y/n prompts, etc.) don't latch into the
   * next interaction cycle.
   */
  onUserInput() {
    this.buf = '';
    if (this.state === 'awaiting_input' || this.state === 'ready') {
      this.state = 'streaming';
    }
  }

  ingest(chunk: string): OutputEvent[] {
    const out: OutputEvent[] = [];
    const text = normalizePtyOutput(chunk);

    // Append and clamp buffer
    this.buf += text;
    if (this.buf.length > 8000) {
      this.buf = this.buf.slice(-8000);
    }
    const tail = this.buf.slice(-1600);

    // 1) Auth detection (latch)
    if (this.config.authPattern.test(this.buf)) {
      if (this.state !== 'auth_required') {
        this.state = 'auth_required';
        out.push({ type: 'state', state: 'auth_required', reason: 'CLI requires authentication' });
      }
      return out;
    }

    // 2) Errors — only flag during booting (CLI startup failure).
    // Once the CLI is running, error patterns in output are model-generated prose
    // ("failed to find the file", etc.) and should not latch the state to error.
    if (this.state === 'booting') {
      if (this.config.errorPattern.test(text)) {
        this.state = 'error';
        out.push({ type: 'state', state: 'error', reason: 'CLI reported an error' });
        return out;
      }
    }

    // 3) Prompt = ready
    // Evaluate prompt before awaiting-input to avoid latching on stale
    // "press enter / y/n" text that can appear earlier in the buffer.
    if (this.config.promptPattern.test(tail)) {
      if (this.state !== 'ready') {
        this.state = 'ready';
        out.push({ type: 'state', state: 'ready' });
      }
      return out;
    }

    // 4) Awaiting user input
    if (this.config.awaitPattern.test(tail)) {
      if (this.state !== 'awaiting_input') {
        this.state = 'awaiting_input';
        out.push({ type: 'state', state: 'awaiting_input', reason: 'CLI is waiting for input' });
      }
      return out;
    }

    // 5) Streaming fallback
    if (text.trim().length > 0 && this.state !== 'streaming' && this.state !== 'booting') {
      this.state = 'streaming';
      out.push({ type: 'state', state: 'streaming' });
    }

    return out;
  }
}
