import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AiProvider, SetupContextOptions, SpawnOptions, TaskContextMeta } from './AiProvider';

const execFileAsync = promisify(execFile);

export class CodexProvider implements AiProvider {
  readonly id = 'codex';
  private cachedPath: string | null = null;

  async getExecutablePath(): Promise<string> {
    if (this.cachedPath) return this.cachedPath;

    try {
      const { stdout } = await execFileAsync('which', ['codex']); // Using the codex client
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

    throw new Error('Codex/Copilot CLI not found. Please install the appropriate CLI tool.');
  }

  getSpawnArgs(_options: SpawnOptions): string[] {
    return []; // Specific args to be defined
  }

  getEnv(_options: SpawnOptions): Record<string, string> {
    return {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'dash',
    } as Record<string, string>;
  }

  setupWorktree(options: SetupContextOptions): void {
    const dashDir = path.join(options.cwd, '.dash');
    try {
      if (!fs.existsSync(dashDir)) {
        fs.mkdirSync(dashDir, { recursive: true });
      }
      fs.writeFileSync(path.join(dashDir, 'prompt.txt'), options.prompt);

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
    // To be implemented
  }
}
