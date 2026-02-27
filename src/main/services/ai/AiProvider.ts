export interface SpawnOptions {
  id: string;
  cwd: string;
  autoApprove?: boolean;
  resume?: boolean;
  isDark?: boolean;
}

export interface TaskContextMeta {
  issueNumbers: number[];
  gitRemote?: string;
}

export interface SetupContextOptions {
  cwd: string;
  id: string;
  prompt: string;
  meta?: TaskContextMeta;
  commitAttributionSetting?: string;
}

export interface AiProvider {
  /**
   * The unique identifier for this provider (e.g., 'claude', 'gemini', 'codex').
   */
  readonly id: string;

  /**
   * Resolve the absolute path to the CLI executable.
   * Throws an error if not installed/found.
   */
  getExecutablePath(): Promise<string>;

  /**
   * Get the arguments to pass to the CLI when spawning.
   */
  getSpawnArgs(options: SpawnOptions): string[];

  /**
   * Build the environment variables to pass to the CLI.
   */
  getEnv(options: SpawnOptions): Record<string, string>;

  /**
   * Setup the worktree before spawning the CLI.
   * This handles writing task context, hooks, or any provider-specific configuration files.
   */
  setupWorktree(options: SetupContextOptions): void;

  /**
   * Read any previously written task context metadata from the worktree.
   */
  readTaskContextMeta(cwd: string): TaskContextMeta | null;

  /**
   * Handle dynamic commit attribution updates while a session is running.
   */
  updateCommitAttribution(cwd: string, ptyId: string, attributionSetting?: string): void;
}
