import * as fs from 'fs';
import * as path from 'path';
import { type WebContents, app } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { createBannerFilter } from './bannerFilter';
import { remoteControlService } from './remoteControlService';

import { AiProvider } from './ai/AiProvider';
import { ClaudeProvider } from './ai/ClaudeProvider';
import { GeminiProvider } from './ai/GeminiProvider';
import { CodexProvider } from './ai/CodexProvider';
import { DatabaseService } from './DatabaseService';
import type { IPty } from 'node-pty';

interface PtyRecord {
  proc: IPty;
  cwd: string;
  isDirectSpawn: boolean;
  owner: WebContents | null;
  provider?: AiProvider;
}

const ptys = new Map<string, PtyRecord>();

let commitAttributionSetting: string | undefined = undefined;

// Provider registry
const providers: Record<string, AiProvider> = {
  claude: new ClaudeProvider(),
  gemini: new GeminiProvider(),
  codex: new CodexProvider(),
};

function getProviderForTask(taskId: string): AiProvider {
  try {
    const task = DatabaseService.getTask(taskId);
    if (task && task.aiProvider && providers[task.aiProvider]) {
      return providers[task.aiProvider];
    }
  } catch {
    // Fallback if task not found
  }
  return providers.claude;
}

export function setCommitAttribution(value: string | undefined): void {
  commitAttributionSetting = value;
  // Re-write settings for all active PTYs
  for (const [id, rec] of ptys) {
    if (rec.provider) {
      rec.provider.updateCommitAttribution(rec.cwd, id, commitAttributionSetting);
    }
  }
}

export function setDesktopNotification(opts: { enabled: boolean }): void {
  hookServer.setDesktopNotification(opts);
}

// Lazy-load node-pty to avoid native binding issues at startup
let ptyModule: typeof import('node-pty') | null = null;
function getPty() {
  if (!ptyModule) {
    ptyModule = require('node-pty');
  }
  return ptyModule!;
}

/**
 * Write task context before spawning.
 * Called from IPC during task creation.
 */
export function writeTaskContext(
  taskId: string,
  cwd: string,
  prompt: string,
  meta?: { issueNumbers: number[]; gitRemote?: string },
): void {
  const provider = getProviderForTask(taskId);
  provider.setupWorktree({
    cwd,
    id: taskId,
    prompt,
    meta,
    commitAttributionSetting,
  });
}

/**
 * Spawn AI CLI directly.
 */
export async function startDirectPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  autoApprove?: boolean;
  resume?: boolean;
  isDark?: boolean;
  sender?: WebContents;
}): Promise<{
  reattached: boolean;
  isDirectSpawn: boolean;
  hasTaskContext: boolean;
  taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null;
}> {
  const existing = ptys.get(options.id);
  if (existing && !existing.isDirectSpawn) {
    try {
      existing.proc.kill();
    } catch {
      /* already dead */
    }
    ptys.delete(options.id);
  } else if (existing) {
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: true, hasTaskContext: false, taskContextMeta: null };
  }

  const pty = getPty();
  const provider = getProviderForTask(options.id);

  const execPath = await provider.getExecutablePath();
  const args = provider.getSpawnArgs(options);
  const env = provider.getEnv(options);

  // Apply hooks and settings
  provider.setupWorktree({
    cwd: options.cwd,
    id: options.id,
    prompt: '', // No prompt here, it was done in writeTaskContext
    commitAttributionSetting,
  });

  const proc = pty.spawn(execPath, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: true,
    owner: options.sender || null,
    provider,
  };

  ptys.set(options.id, record);
  activityMonitor.register(options.id, proc.pid, true);

  const bannerFilter = createBannerFilter((filtered: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, filtered);
    }
  });

  proc.onData((data: string) => {
    bannerFilter(data);
    remoteControlService.onPtyData(options.id, data);
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    if (ptys.get(options.id) !== record) return;
    activityMonitor.unregister(options.id);
    remoteControlService.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  const taskContextMeta = provider.readTaskContextMeta(options.cwd);

  return {
    reattached: false,
    isDirectSpawn: true,
    hasTaskContext: !!taskContextMeta,
    taskContextMeta,
  };
}

// ---------------------------------------------------------------------------
// Custom zsh prompt via ZDOTDIR
// ---------------------------------------------------------------------------

const SHELL_ZSHENV = `\\
# Save our ZDOTDIR so .zshrc can find prompt.zsh
export __DASH_ZDOTDIR="\${ZDOTDIR}"
# Source user's .zshenv from HOME
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
# Keep ZDOTDIR as our dir so zsh loads .zshrc etc. from here
ZDOTDIR="\${__DASH_ZDOTDIR}"
`;

const SHELL_ZPROFILE = `\\
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
`;

const SHELL_ZSHRC = `\\
# Restore ZDOTDIR to HOME so user config loads normally
ZDOTDIR="$HOME"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Apply our prompt after user config
source "\${__DASH_ZDOTDIR}/prompt.zsh"
`;

const SHELL_ZLOGIN = `\\
[[ -f "$HOME/.zlogin" ]] && source "$HOME/.zlogin"
`;

const SHELL_PROMPT = `\\
# Dash badge-style prompt — uses ANSI 16 colors (themed by xterm.js)
autoload -Uz vcs_info add-zsh-hook

# Prevent venv from prepending (name) to prompt
export VIRTUAL_ENV_DISABLE_PROMPT=1

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes false
zstyle ':vcs_info:git:*' formats '%b'

__dash_prompt_precmd() {
  vcs_info

  local dir="%F{12}%~%f"
  local branch=""
  if [[ -n "\${vcs_info_msg_0_}" ]]; then
    local dirty=""
    # Fast dirty check: staged + unstaged + untracked
    if ! git diff --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null | head -1)" ]]; then
      dirty="%F{3}*%f"
    fi
    branch="  %F{5}\${vcs_info_msg_0_}\${dirty}%f"
  fi

  local venv=""
  if [[ -n "\${VIRTUAL_ENV}" ]]; then
    venv="  %F{6}\${VIRTUAL_ENV:t}%f"
  fi

  PROMPT="\${dir}\${branch}\${venv}
%F{%(?.2.1)}\\$%f "
  RPROMPT=""
}

add-zsh-hook precmd __dash_prompt_precmd
# Set PROMPT immediately so the first prompt is styled — precmd may not
# fire before the initial prompt in all zsh configurations.
__dash_prompt_precmd
`;

let shellConfigDir: string | null = null;

function ensureShellConfig(): string {
  if (shellConfigDir) return shellConfigDir;

  const dir = path.join(app.getPath('userData'), 'shell');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const files: Record<string, string> = {
    '.zshenv': SHELL_ZSHENV,
    '.zprofile': SHELL_ZPROFILE,
    '.zshrc': SHELL_ZSHRC,
    '.zlogin': SHELL_ZLOGIN,
    'prompt.zsh': SHELL_PROMPT,
  };

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    if (existing !== content) {
      fs.writeFileSync(filePath, content);
    }
  }

  shellConfigDir = dir;
  return dir;
}

/**
 * Spawn interactive shell (fallback path).
 */
export async function startPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  sender?: WebContents;
}): Promise<{ reattached: boolean; isDirectSpawn: boolean }> {
  const existing = ptys.get(options.id);
  if (existing) {
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: existing.isDirectSpawn };
  }

  const pty = getPty();

  const shell = process.env.SHELL || '/bin/bash';
  const args = ['-il'];

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  env.TERM_PROGRAM = 'Apple_Terminal';

  if (shell.endsWith('/zsh') || shell === 'zsh') {
    env.ZDOTDIR = ensureShellConfig();
  }

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: env as Record<string, string>,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.sender || null,
  };

  ptys.set(options.id, record);
  activityMonitor.register(options.id, proc.pid, false);

  proc.onData((data: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, data);
    }
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    if (ptys.get(options.id) !== record) return;
    activityMonitor.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  return { reattached: false, isDirectSpawn: false };
}

/**
 * Enable remote control for a PTY.
 */
export function sendRemoteControl(id: string): void {
  remoteControlService.startWatching(id);
  writePty(id, '/rc');
  setTimeout(() => writePty(id, '\\r'), 100);
}

export function writePty(id: string, data: string): void {
  const record = ptys.get(id);
  if (record) {
    record.proc.write(data);
  }
}

export function resizePty(id: string, cols: number, rows: number): void {
  const record = ptys.get(id);
  if (record) {
    try {
      record.proc.resize(cols, rows);
    } catch (_err) {
      // Ignore
    }
  }
}

export function killPty(id: string): void {
  const record = ptys.get(id);
  if (record) {
    ptys.delete(id);
    activityMonitor.unregister(id);
    remoteControlService.unregister(id);
    try {
      record.proc.kill();
    } catch (_err) {
      // Ignore
    }
  }
}

export function killAll(): void {
  for (const [, record] of ptys) {
    try {
      record.proc.kill();
    } catch (_err) {
      // Ignore
    }
  }
  ptys.clear();
  activityMonitor.stop();
}

export function killByOwner(owner: WebContents): void {
  for (const [id, record] of ptys) {
    if (record.owner === owner) {
      try {
        record.proc.kill();
      } catch {
        activityMonitor.unregister(id);
      }
      ptys.delete(id);
    }
  }
}
