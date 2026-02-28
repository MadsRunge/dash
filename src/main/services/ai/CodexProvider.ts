import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AiProvider, SetupContextOptions, SpawnOptions, TaskContextMeta } from './AiProvider';
import { OutputParser } from './OutputParser';
import { GenericOutputParser } from './GenericOutputParser';
import { PromptFormatter } from './PromptFormatter';

const execFileAsync = promisify(execFile);

export class CodexProvider implements AiProvider {
  readonly id = 'codex';
  private cachedPath: string | null = null;

  async getExecutablePath(): Promise<string> {
    if (this.cachedPath) return this.cachedPath;

    try {
      const { stdout } = await execFileAsync('which', ['codex']);
      const resolved = stdout.trim();
      if (resolved) {
        this.cachedPath = resolved;
        return this.cachedPath;
      }
    } catch {
      // Not in PATH
    }

    const home = os.homedir();
    const candidates = [
      path.join(home, '.local/bin/codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
    ];
    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.X_OK);
        this.cachedPath = candidate;
        return this.cachedPath;
      } catch {
        // Not found here
      }
    }

    throw new Error('Codex CLI not found. Install it with: npm install -g @openai/codex');
  }

  getSpawnArgs(options: SpawnOptions): string[] {
    if (options.resume) {
      // 'codex resume --last' resumes the most recent session — no initial prompt needed
      const args = ['resume', '--last'];
      if (options.autoApprove) {
        args.push('--full-auto');
      }
      return args;
    }

    const args: string[] = [];

    try {
      const promptPath = path.join(options.cwd, '.dash', 'prompt.txt');
      if (fs.existsSync(promptPath)) {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        args.push(promptContent);
      }
    } catch {
      // Ignore
    }

    if (options.autoApprove) {
      // --full-auto sets --ask-for-approval on-request + --sandbox workspace-write
      args.push('--full-auto');
    }

    return args;
  }

  getEnv(options: SpawnOptions): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'dash',
      COLORFGBG: (options.isDark ?? true) ? '15;0' : '0;15',
    };

    const authVars = [
      'OPENAI_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy',
    ];

    for (const key of authVars) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    return env as Record<string, string>;
  }

  setupWorktree(options: SetupContextOptions): void {
    const dashDir = path.join(options.cwd, '.dash');
    const promptPath = path.join(dashDir, 'prompt.txt');

    try {
      if (!fs.existsSync(dashDir)) {
        fs.mkdirSync(dashDir, { recursive: true });
      }

      const content = PromptFormatter.formatGuardedPrompt(options.prompt, options.meta);
      fs.writeFileSync(promptPath, content);

      if (options.meta) {
        fs.writeFileSync(path.join(dashDir, 'meta.json'), JSON.stringify(options.meta));
      }
    } catch (err) {
      console.error('[CodexProvider] Failed to setup worktree:', err);
      throw new Error(
        `Failed to write task context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  readTaskContextMeta(cwd: string): TaskContextMeta | null {
    const metaPath = path.join(cwd, '.dash', 'meta.json');
    try {
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      }
    } catch {
      // Ignore
    }
    return null;
  }

  updateCommitAttribution(_cwd: string, _ptyId: string, _attributionSetting?: string): void {
    // No-op: Codex does not support custom commit attribution config
  }

  getOutputParser(): OutputParser {
    return new GenericOutputParser({
      // Codex is a full TUI — after ANSI stripping its composer area shows "> "
      // at the bottom. This pattern matches when the TUI is ready for input.
      promptPattern: /(?:^|\n)\s*>\s*$/m,
      // Codex supports ChatGPT Plus/Pro OAuth login or OPENAI_API_KEY.
      // These patterns cover both the initial sign-in TUI and API key errors.
      authPattern:
        /(sign\s+in\s+with\s+chatgpt|sign\s+in\s+to\s+continue|not\s+authenticated|invalid\s+api\s+key|api\s+key\s+not\s+set|please\s+set\s+openai_api_key|authentication\s+failed|unauthorized)/i,
      awaitPattern:
        /(?:^|\n).*(?:\b(y\/n)\b|\bcontinue\?\b|\bpress\s+enter\b|\bapprove\b|\bdeny\b).*$/im,
      errorPattern: /(^\s*error:|failed\s+to|exception:|rate\s+limit)/im,
    });
  }
}
