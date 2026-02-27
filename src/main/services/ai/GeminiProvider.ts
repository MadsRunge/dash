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

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  private cachedPath: string | null = null;

  async getExecutablePath(): Promise<string> {
    if (this.cachedPath) return this.cachedPath;

    try {
      const { stdout } = await execFileAsync('which', ['gemini']);
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
      path.join(home, '.local/bin/gemini'),
      '/opt/homebrew/bin/gemini',
      '/usr/local/bin/gemini',
      path.join(home, 'go/bin/gemini'),
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

    throw new Error('Gemini CLI not found. Please ensure it is installed and in your PATH.');
  }

  getSpawnArgs(options: SpawnOptions): string[] {
    const args: string[] = [];

    try {
      const promptPath = path.join(options.cwd, '.dash', 'prompt.txt');
      if (fs.existsSync(promptPath)) {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        args.push('-i', promptContent);
      }
    } catch {
      // Ignore
    }

    if (options.autoApprove) {
      args.push('-y');
    }

    if (options.resume) {
      args.push('-r', 'latest');
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
      console.error('[GeminiProvider] Failed to setup worktree:', err);
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
    console.log('[GeminiProvider] Attribution update not currently supported');
  }

  getOutputParser(): OutputParser {
    return new GenericOutputParser({
      promptPattern: /(?:^|\n)(?:gemini|>)>\s?$/m,
      authPattern: /(please\s+login|unauthorized|not\s+authenticated|sign\s+in)/i,
      awaitPattern: /(?:^|\n).*(?:\b(y\/n)\b|\bcontinue\?\b|\bpress\s+enter\b|\bselect\b).*$/im,
      errorPattern: /(error|failed|exception|traceback)/i,
    });
  }
}
