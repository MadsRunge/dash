import { OutputEvent, OutputParser, ProviderState, normalizePtyOutput } from './OutputParser';

export class GeminiOutputParser implements OutputParser {
  private buf = '';
  private state: ProviderState = 'booting';

  // Regex patterns tailored for Gemini CLI output
  private rePrompt = /(?:^|\n)(?:gemini|>)>\s?$/m;
  private reAuth = /(please\s+login|unauthorized|not\s+authenticated|sign\s+in)/i;
  private reAwait = /(?:^|\n).*(?:\b(y\/n)\b|\bcontinue\?\b|\bpress\s+enter\b|\bselect\b).*$/im;
  private reError = /(error|failed|exception|traceback)/i;

  reset() {
    this.buf = '';
    this.state = 'booting';
  }

  ingest(chunk: string): OutputEvent[] {
    const out: OutputEvent[] = [];
    const text = normalizePtyOutput(chunk);

    // Append and clamp buffer (prevent infinite growth)
    this.buf += text;
    if (this.buf.length > 8000) {
      this.buf = this.buf.slice(-8000);
    }

    // 1) Auth detection (latch)
    if (this.reAuth.test(this.buf)) {
      if (this.state !== 'auth_required') {
        this.state = 'auth_required';
        out.push({ type: 'state', state: 'auth_required', reason: 'Gemini CLI requires login' });
      }
      return out;
    }

    // 2) Errors (be careful: models might output the word "error" in normal text)
    // Here we check the normalized recent text.
    if (this.state !== 'streaming' && this.reError.test(text)) {
      this.state = 'error';
      out.push({ type: 'state', state: 'error', reason: 'Gemini CLI reported an error' });
      // We don't return early here; a prompt might still appear after an error.
    }

    // 3) Awaiting user input (y/n, continue, etc.)
    if (this.reAwait.test(this.buf)) {
      if (this.state !== 'awaiting_input') {
        this.state = 'awaiting_input';
        out.push({ type: 'state', state: 'awaiting_input', reason: 'CLI is waiting for input' });
      }
      return out;
    }

    // 4) Prompt = ready
    // Crucial: prompt can arrive in the same chunk as the end of an output stream.
    if (this.rePrompt.test(this.buf)) {
      if (this.state !== 'ready') {
        this.state = 'ready';
        out.push({ type: 'state', state: 'ready' });
      }
      return out;
    }

    // 5) Streaming fallback
    // If there is non-trivial output and we aren't ready, assume the model is generating.
    if (text.trim().length > 0 && this.state !== 'streaming' && this.state !== 'booting') {
      this.state = 'streaming';
      out.push({ type: 'state', state: 'streaming' });
    }

    return out;
  }
}
