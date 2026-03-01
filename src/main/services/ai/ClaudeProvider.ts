import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { hookServer } from '../HookServer';
import { AiProvider, SetupContextOptions, SpawnOptions, TaskContextMeta } from './AiProvider';
import { PromptFormatter } from './PromptFormatter';

const execFileAsync = promisify(execFile);

export const DASH_DEFAULT_ATTRIBUTION =
  '\\n\\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

export class ClaudeProvider implements AiProvider {
  readonly id = 'claude';
  private cachedClaudePath: string | null = null;

  async getExecutablePath(): Promise<string> {
    if (this.cachedClaudePath) return this.cachedClaudePath;

    try {
      const { claudeCliCache } = await import('../../main');
      if (claudeCliCache.path) {
        this.cachedClaudePath = claudeCliCache.path;
        return this.cachedClaudePath;
      }
    } catch {
      // Best effort
    }

    try {
      const { stdout } = await execFileAsync('which', ['claude']);
      const resolved = stdout.trim();
      if (resolved) {
        this.cachedClaudePath = resolved;
        return this.cachedClaudePath;
      }
    } catch {
      // Not in PATH
    }

    const home = os.homedir();
    const candidates = [
      path.join(home, '.local/bin/claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.X_OK);
        this.cachedClaudePath = candidate;
        return this.cachedClaudePath;
      } catch {
        // Not found here
      }
    }

    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  getSpawnArgs(options: SpawnOptions): string[] {
    const args: string[] = [];
    if (options.resume) {
      args.push('-c', '-r');
    }
    if (options.autoApprove) {
      // Safer auto mode: allow edit flow without full permission bypass.
      // This avoids granting broad unrestricted local access.
      args.push('--permission-mode', 'acceptEdits');
    }
    return args;
  }

  getEnv(options: SpawnOptions): Record<string, string> {
    const env: Record<string, string> = {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'dash',
      HOME: os.homedir(),
      USER: os.userInfo().username,
      PATH: process.env.PATH || '',
      COLORFGBG: (options.isDark ?? true) ? '15;0' : '0;15',
    };

    const authVars = [
      'ANTHROPIC_API_KEY',
      'GH_TOKEN',
      'GITHUB_TOKEN',
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

    return env;
  }

  setupWorktree(options: SetupContextOptions): void {
    const claudeDir = path.join(options.cwd, '.claude');

    // Ensure dir exists
    try {
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
    } catch (err) {
      console.error('[ClaudeProvider] Failed to create .claude dir:', err);
      return;
    }

    // Write task-context.json if prompt is provided
    if (options.prompt) {
      const contextPath = path.join(claudeDir, 'task-context.json');
      const prompt = options.isOrchestrated
        ? PromptFormatter.formatOrchestratorPrompt(options.prompt, options.meta)
        : options.prompt;
      const payload: Record<string, unknown> = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: prompt,
        },
      };
      if (options.meta) {
        payload.meta = options.meta;
      }
      try {
        fs.writeFileSync(contextPath, JSON.stringify(payload, null, 2) + '\n');
      } catch (err) {
        console.error('[ClaudeProvider] Failed to write task-context.json:', err);
      }
    }

    // Trust the worktree folder in Claude's project config to suppress
    // the initial "Do you trust this folder?" prompt in spawned subtasks.
    this.trustFolder(options.cwd);

    // Write settings.local.json
    this.writeHookSettings(options.cwd, options.id, options.commitAttributionSetting);
  }

  private writeHookSettings(cwd: string, ptyId: string, attributionSetting?: string): void {
    const port = hookServer.port;
    if (port === 0) return;

    const claudeDir = path.join(cwd, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    const hookSettings: Record<string, unknown[]> = {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 http://127.0.0.1:\${port}/hook/stop?ptyId=\${ptyId}`,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 http://127.0.0.1:\${port}/hook/busy?ptyId=\${ptyId}`,
            },
          ],
        },
      ],
      Notification: [
        {
          matcher: 'permission_prompt',
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- http://127.0.0.1:\${port}/hook/notification?ptyId=\${ptyId}`,
            },
          ],
        },
        {
          matcher: 'idle_prompt',
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- http://127.0.0.1:\${port}/hook/notification?ptyId=\${ptyId}`,
            },
          ],
        },
      ],
    };

    const contextPath = path.join(claudeDir, 'task-context.json');
    if (fs.existsSync(contextPath)) {
      hookSettings.SessionStart = [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: `cat "\${contextPath}"`,
            },
          ],
        },
      ];
    }

    try {
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Corrupted
        }
      }

      const merged: Record<string, unknown> = {
        ...existing,
        hooks: {
          ...(existing.hooks && typeof existing.hooks === 'object'
            ? (existing.hooks as Record<string, unknown>)
            : {}),
          ...hookSettings,
        },
      };

      const effectiveAttribution =
        attributionSetting === undefined ? DASH_DEFAULT_ATTRIBUTION : attributionSetting;
      merged.attribution = { commit: effectiveAttribution };

      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    } catch (err) {
      console.error('[ClaudeProvider] Failed to write settings.local.json:', err);
    }
  }

  private trustFolder(folderPath: string): void {
    const configPath = path.join(os.homedir(), '.claude.json');
    try {
      const parsed = fs.existsSync(configPath)
        ? (JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>)
        : {};
      const projects =
        parsed.projects && typeof parsed.projects === 'object'
          ? (parsed.projects as Record<string, Record<string, unknown>>)
          : {};

      const candidates = new Set<string>([folderPath]);
      try {
        candidates.add(fs.realpathSync(folderPath));
      } catch {
        // Ignore realpath resolution issues
      }
      if (!folderPath.startsWith('/private/')) {
        candidates.add(`/private${folderPath}`);
      } else {
        candidates.add(folderPath.replace(/^\/private/, ''));
      }

      let changed = false;
      for (const candidate of candidates) {
        const current =
          projects[candidate] && typeof projects[candidate] === 'object' ? projects[candidate] : {};
        if (current.hasTrustDialogAccepted === true) continue;
        projects[candidate] = {
          ...current,
          hasTrustDialogAccepted: true,
        };
        changed = true;
      }

      if (!changed) return;
      parsed.projects = projects;
      fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2));
    } catch {
      // Non-fatal — Claude may ask for trust manually if we cannot update config
    }
  }

  readTaskContextMeta(cwd: string): TaskContextMeta | null {
    const contextPath = path.join(cwd, '.claude', 'task-context.json');
    try {
      if (fs.existsSync(contextPath)) {
        const parsed = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
        return parsed.meta ?? null;
      }
    } catch {
      // Best effort
    }
    return null;
  }

  updateCommitAttribution(cwd: string, ptyId: string, attributionSetting?: string): void {
    this.writeHookSettings(cwd, ptyId, attributionSetting);
  }
}
