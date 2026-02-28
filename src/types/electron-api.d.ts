import type {
  IpcResponse,
  Project,
  Task,
  Conversation,
  WorktreeInfo,
  TerminalSnapshot,
  GitStatus,
  DiffResult,
  BranchInfo,
  GithubIssue,
  GithubLabel,
  CommitGraphData,
  CommitDetail,
  RemoteControlState,
  ActivityState,
} from '../shared/types';

export interface ElectronAPI {
  // App
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;

  // Dialogs
  showOpenDialog: () => Promise<IpcResponse<string[]>>;
  openExternal: (url: string) => Promise<void>;
  openInEditor: (args: {
    cwd: string;
    filePath: string;
    line?: number;
    col?: number;
  }) => Promise<IpcResponse<null>>;

  // Database - Projects
  getProjects: () => Promise<IpcResponse<Project[]>>;
  saveProject: (
    project: Partial<Project> & { name: string; path: string },
  ) => Promise<IpcResponse<Project>>;
  deleteProject: (id: string) => Promise<IpcResponse<void>>;

  // Database - Tasks
  getTasks: (projectId: string) => Promise<IpcResponse<Task[]>>;
  saveTask: (
    task: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ) => Promise<IpcResponse<Task>>;
  deleteTask: (id: string) => Promise<IpcResponse<void>>;
  archiveTask: (id: string) => Promise<IpcResponse<void>>;
  restoreTask: (id: string) => Promise<IpcResponse<void>>;

  // Database - Conversations
  getConversations: (taskId: string) => Promise<IpcResponse<Conversation[]>>;
  getOrCreateDefaultConversation: (taskId: string) => Promise<IpcResponse<Conversation>>;

  // Worktree
  worktreeCreate: (args: {
    projectPath: string;
    taskName: string;
    baseRef?: string;
    projectId: string;
    linkedIssueNumbers?: number[];
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreePath: string;
    branch: string;
    options?: {
      deleteWorktreeDir?: boolean;
      deleteLocalBranch?: boolean;
      deleteRemoteBranch?: boolean;
    };
  }) => Promise<IpcResponse<void>>;
  worktreeClaimReserve: (args: {
    projectId: string;
    taskName: string;
    baseRef?: string;
    linkedIssueNumbers?: number[];
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeEnsureReserve: (args: {
    projectId: string;
    projectPath: string;
  }) => Promise<IpcResponse<void>>;
  worktreeHasReserve: (projectId: string) => Promise<IpcResponse<boolean>>;

  // PTY
  ptyStartDirect: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
    autoApprove?: boolean;
    resume?: boolean;
    isDark?: boolean;
  }) => Promise<
    IpcResponse<{
      reattached: boolean;
      isDirectSpawn: boolean;
      hasTaskContext: boolean;
      taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null;
    }>
  >;
  ptyStart: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
  }) => Promise<IpcResponse<{ reattached: boolean; isDirectSpawn: boolean }>>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, callback: (data: string) => void) => () => void;
  onPtyExit: (
    id: string,
    callback: (info: { exitCode: number; signal?: number }) => void,
  ) => () => void;

  // Activity monitor
  ptyGetAllActivity: () => Promise<IpcResponse<Record<string, ActivityState>>>;
  ptySetIdle: (ptyId: string) => Promise<IpcResponse<void>>;
  onPtyActivity: (callback: (data: Record<string, ActivityState>) => void) => () => void;

  // Remote control
  ptyRemoteControlEnable: (ptyId: string) => Promise<IpcResponse<void>>;
  ptyRemoteControlGetAllStates: () => Promise<IpcResponse<Record<string, RemoteControlState>>>;
  onRemoteControlStateChanged: (
    callback: (data: { ptyId: string; state: RemoteControlState | null }) => void,
  ) => () => void;

  // Snapshots
  ptyGetSnapshot: (id: string) => Promise<IpcResponse<TerminalSnapshot | null>>;
  ptySaveSnapshot: (id: string, payload: TerminalSnapshot) => void;
  ptyClearSnapshot: (id: string) => Promise<IpcResponse<void>>;

  // Session detection
  ptyHasClaudeSession: (cwd: string) => Promise<IpcResponse<boolean>>;

  // Task context for SessionStart hook
  ptyWriteTaskContext: (args: {
    taskId: string;
    cwd: string;
    prompt: string;
    meta?: { issueNumbers: number[]; gitRemote?: string };
    isOrchestrated?: boolean;
  }) => Promise<IpcResponse<void>>;

  // App lifecycle
  onBeforeQuit: (callback: () => void) => () => void;
  onFocusTask: (callback: (taskId: string) => void) => () => void;
  onToast: (callback: (data: { message: string; url?: string }) => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) => void;
  setCommitAttribution: (value: string | undefined) => void;
  getClaudeAttribution: (projectPath?: string) => Promise<IpcResponse<string | null>>;

  // GitHub
  githubCheckAvailable: () => Promise<IpcResponse<boolean>>;
  githubSearchIssues: (cwd: string, query: string) => Promise<IpcResponse<GithubIssue[]>>;
  githubGetIssue: (cwd: string, number: number) => Promise<IpcResponse<GithubIssue>>;
  githubPostBranchComment: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  githubLinkBranch: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  githubCreateIssue: (args: {
    cwd: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }) => Promise<IpcResponse<GithubIssue>>;
  githubListAllIssues: (cwd: string, state?: string) => Promise<IpcResponse<GithubIssue[]>>;
  githubListLabels: (cwd: string) => Promise<IpcResponse<GithubLabel[]>>;
  githubGetDefaultBranch: (cwd: string) => Promise<IpcResponse<string>>;
  githubGetPrCommits: (
    cwd: string,
    base: string,
    head: string,
  ) => Promise<
    IpcResponse<Array<{ hash: string; subject: string; authorName: string; authorDate: number }>>
  >;
  githubCreatePr: (args: {
    cwd: string;
    title: string;
    body: string;
    base: string;
    draft?: boolean;
  }) => Promise<IpcResponse<string>>;

  // Git detection
  detectGit: (
    folderPath: string,
  ) => Promise<IpcResponse<{ remote: string | null; branch: string | null }>>;
  detectClaude: () => Promise<
    IpcResponse<{ installed: boolean; version: string | null; path: string | null }>
  >;

  // Git operations
  gitClone: (args: { url: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
  gitGetStatus: (cwd: string) => Promise<IpcResponse<GitStatus>>;
  gitGetDiff: (args: {
    cwd: string;
    filePath?: string;
    staged?: boolean;
    contextLines?: number;
  }) => Promise<IpcResponse<DiffResult>>;
  gitGetDiffUntracked: (args: {
    cwd: string;
    filePath: string;
    contextLines?: number;
  }) => Promise<IpcResponse<DiffResult>>;
  gitStageFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitStageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitUnstageFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitUnstageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitDiscardFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitCommit: (args: { cwd: string; message: string }) => Promise<IpcResponse<void>>;
  gitPush: (cwd: string) => Promise<IpcResponse<void>>;

  // Commit graph
  gitGetCommitGraph: (args: {
    cwd: string;
    limit?: number;
    skip?: number;
  }) => Promise<IpcResponse<CommitGraphData>>;
  gitGetCommitDetail: (args: { cwd: string; hash: string }) => Promise<IpcResponse<CommitDetail>>;

  // Branch listing
  gitListBranches: (cwd: string) => Promise<IpcResponse<BranchInfo[]>>;

  // File watcher
  gitWatch: (args: { id: string; cwd: string }) => Promise<IpcResponse<void>>;
  gitUnwatch: (id: string) => Promise<IpcResponse<void>>;
  onGitFileChanged: (callback: (id: string) => void) => () => void;

  // Orchestrator
  orchestratorGetSubtasks: (orchestratorTaskId: string) => Promise<IpcResponse<Task[]>>;
  orchestratorMergeSubtasks: (orchestratorTaskId: string) => Promise<
    IpcResponse<{
      preflight: { ok: boolean; reason?: string; details?: string[] };
      results: Array<{
        id: string;
        title: string;
        branch: string;
        state: 'merged' | 'skipped' | 'conflict' | 'failed';
        reason?: string;
        details?: string[];
      }>;
      conflicts: string[];
      merged: number;
      skipped: number;
      failed: number;
    }>
  >;
  orchestratorUpdateStatus: (
    orchestratorTaskId: string,
    activityStates: Record<string, string>,
  ) => Promise<IpcResponse<void>>;
  onOrchestratorSubtasksSpawned: (
    callback: (data: { orchestratorTaskId: string; subtasks: Task[] }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
