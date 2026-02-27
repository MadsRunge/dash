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

    throw new Error('Codex CLI ikke fundet. Installer den med: npm install -g @openai/codex');
  }

  getSpawnArgs(options: SpawnOptions): string[] {
    const args: string[] = [];

    // Læs den gemte prompt fra .dash mappen
    try {
      const promptPath = path.join(options.cwd, '.dash', 'prompt.txt');
      if (fs.existsSync(promptPath)) {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        // Codex tager prompten direkte som et positionelt argument for at starte TUI'en med en opgave
        args.push(promptContent);
      }
    } catch {
      // Ignorer hvis prompten ikke findes
    }

    // Auto-approve tool usage (Yolo mode)
    if (options.autoApprove) {
      args.push('--approval-mode', 'full-auto');
    }

    // Codex understøtter mig bekendt ikke en direkte `--resume` flag på samme måde som Claude/Gemini,
    // men den samler ofte selv tråden op fra sin egen historik i mappen.

    return args;
  }

  getEnv(options: SpawnOptions): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'dash',
    };

    // Sikr at OpenAI API nøgler og proxy-indstillinger sendes med
    const authVars = [
      'OPENAI_API_KEY',
      'AZURE_OPENAI_API_KEY',
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

      let content = options.prompt;
      if (options.meta && options.meta.issueNumbers && options.meta.issueNumbers.length > 0) {
        content += `\\n\\nLinked Issues: ${options.meta.issueNumbers.join(', ')}`;
      }

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
    // Implementeres hvis Codex senere understøtter en custom attribution config
  }
}
