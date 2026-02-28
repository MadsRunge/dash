import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { getRawDb } from '../db/client';
import { DatabaseService } from './DatabaseService';
import { WorktreeService } from './WorktreeService';
import type { Task, Project, WorktreeInfo } from '../../shared/types';

const execFileAsync = promisify(execFile);

export interface SubtaskDefinition {
  title: string;
  provider: string;
  description: string;
  focusFiles?: string[];
}

export interface SubtaskPlan {
  subtasks: SubtaskDefinition[];
}

export interface SubtaskStatus {
  id: string;
  title: string;
  state: string;
  branch: string;
  error?: string;
}

export interface StatusError {
  code: string;
  message: string;
  details?: string[];
}

interface PlanValidationResult {
  ok: boolean;
  plan?: SubtaskPlan;
  error?: StatusError;
}

interface PreparedSubtask {
  index: number;
  taskId: string;
  definition: SubtaskDefinition;
  worktreeInfo: WorktreeInfo;
}

interface SpawnFailure {
  index: number;
  message: string;
}

export type MergeSubtaskState = 'merged' | 'skipped' | 'conflict' | 'failed';

export interface MergeSubtaskResult {
  id: string;
  title: string;
  branch: string;
  state: MergeSubtaskState;
  reason?: string;
  details?: string[];
}

export interface MergePreflight {
  ok: boolean;
  reason?: string;
  details?: string[];
}

export interface MergeExecutionResult {
  preflight: MergePreflight;
  results: MergeSubtaskResult[];
  conflicts: string[];
  merged: number;
  skipped: number;
  failed: number;
}

// Active watchers: orchestratorTaskId -> FSWatcher
const watchers = new Map<string, fs.FSWatcher>();

const worktreeService = new WorktreeService();

export function startWatching(
  orchestratorTask: Task,
  project: Project,
  onSubtasksSpawned: (subtasks: Task[]) => void,
): void {
  if (watchers.has(orchestratorTask.id)) return;

  const dashDir = path.join(orchestratorTask.path, '.dash');
  const planPath = path.join(orchestratorTask.path, '.dash', 'subtasks.json');
  fs.mkdirSync(dashDir, { recursive: true });

  if (fs.existsSync(planPath)) {
    processPlanFile(planPath, orchestratorTask, project, onSubtasksSpawned);
  }

  const watcher = fs.watch(dashDir, { persistent: false }, (_event, filename) => {
    if (filename === 'subtasks.json' && fs.existsSync(planPath)) {
      processPlanFile(planPath, orchestratorTask, project, onSubtasksSpawned);
    }
  });

  watchers.set(orchestratorTask.id, watcher);
}

export function stopWatching(orchestratorTaskId: string): void {
  const watcher = watchers.get(orchestratorTaskId);
  if (watcher) {
    watcher.close();
    watchers.delete(orchestratorTaskId);
  }
}

async function processPlanFile(
  planPath: string,
  orchestratorTask: Task,
  project: Project,
  onSubtasksSpawned: (subtasks: Task[]) => void,
): Promise<void> {
  try {
    const content = fs.readFileSync(planPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const validation = validateSubtaskPlan(parsed);
    if (!validation.ok || !validation.plan) {
      updateStatusFile(orchestratorTask.path, [], {}, validation.error);
      return;
    }

    const existing = DatabaseService.getSubtasks(orchestratorTask.id);
    if (existing.length > 0) return;

    const spawnedTasks = await spawnSubtasks(validation.plan, orchestratorTask, project);
    if (spawnedTasks.length === 0) return;
    onSubtasksSpawned(spawnedTasks);
  } catch (error) {
    updateStatusFile(
      orchestratorTask.path,
      [],
      {},
      {
        code: 'invalid_json',
        message: 'Unable to parse .dash/subtasks.json',
        details: [error instanceof Error ? error.message : String(error)],
      },
    );
  }
}

async function spawnSubtasks(
  plan: SubtaskPlan,
  orchestratorTask: Task,
  project: Project,
): Promise<Task[]> {
  const prepared: PreparedSubtask[] = [];
  const failures: SpawnFailure[] = [];

  for (let index = 0; index < plan.subtasks.length; index++) {
    const sub = plan.subtasks[index];
    try {
      const worktreeInfo = await worktreeService.createWorktree(project.path, sub.title, {
        projectId: project.id,
      });

      const dashDir = path.join(worktreeInfo.path, '.dash');
      if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
      fs.writeFileSync(path.join(dashDir, 'prompt.txt'), formatSubtaskPrompt(sub));

      prepared.push({
        index,
        taskId: randomUUID(),
        definition: sub,
        worktreeInfo,
      });
    } catch (error) {
      failures.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) {
    await cleanupPreparedWorktrees(project.path, prepared);
    updateStatusFile(
      orchestratorTask.path,
      buildSpawnFailureStatuses(plan, prepared, failures, 'Rolled back after spawn failure'),
      {},
      {
        code: 'spawn_failed',
        message: 'Failed to spawn one or more subtasks',
        details: failures.map((f) => `subtasks[${f.index}]: ${f.message}`),
      },
    );
    return [];
  }

  try {
    const spawnedTasks = savePreparedSubtasksAtomic(
      prepared,
      project.id,
      orchestratorTask.id,
      orchestratorTask.autoApprove,
    );
    updateStatusFile(orchestratorTask.path, spawnedTasks, {});
    return spawnedTasks;
  } catch (error) {
    await cleanupPreparedWorktrees(project.path, prepared);
    const message = error instanceof Error ? error.message : String(error);
    updateStatusFile(
      orchestratorTask.path,
      buildSpawnFailureStatuses(
        plan,
        prepared,
        [],
        'Rolled back after database transaction failure',
      ),
      {},
      {
        code: 'db_transaction_failed',
        message: 'Subtask creation transaction failed',
        details: [message],
      },
    );
    return [];
  }
}

function savePreparedSubtasksAtomic(
  prepared: PreparedSubtask[],
  projectId: string,
  orchestratorTaskId: string,
  autoApprove: boolean,
): Task[] {
  const rawDb = getRawDb();
  if (!rawDb) throw new Error('Raw database not available');

  const now = new Date().toISOString();
  const insert = rawDb.prepare(`
    INSERT INTO tasks (
      id,
      project_id,
      name,
      description,
      branch,
      path,
      ai_provider,
      status,
      use_worktree,
      auto_approve,
      linked_issues,
      orchestrator_task_id,
      archived_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = rawDb.transaction((rows: PreparedSubtask[]) => {
    for (const row of rows) {
      insert.run(
        row.taskId,
        projectId,
        row.definition.title,
        row.definition.description,
        row.worktreeInfo.branch,
        row.worktreeInfo.path,
        normalizeProvider(row.definition.provider, 'claude'),
        'idle',
        1,
        autoApprove ? 1 : 0,
        null,
        orchestratorTaskId,
        null,
        now,
        now,
      );
    }
  });

  tx(prepared);

  const savedTasks: Task[] = [];
  for (const row of prepared) {
    const task = DatabaseService.getTask(row.taskId);
    if (!task) {
      throw new Error(`Created subtask not found after transaction: ${row.taskId}`);
    }
    savedTasks.push(task);
  }

  return savedTasks;
}

async function cleanupPreparedWorktrees(
  projectPath: string,
  prepared: PreparedSubtask[],
): Promise<void> {
  for (let i = prepared.length - 1; i >= 0; i--) {
    const row = prepared[i];
    try {
      await worktreeService.removeWorktree(
        projectPath,
        row.worktreeInfo.path,
        row.worktreeInfo.branch,
        {
          deleteWorktreeDir: true,
          deleteLocalBranch: true,
          deleteRemoteBranch: false,
        },
      );
    } catch {
      // Best effort cleanup
    }
  }
}

function buildSpawnFailureStatuses(
  plan: SubtaskPlan,
  prepared: PreparedSubtask[],
  failures: SpawnFailure[],
  defaultErrorMessage: string,
): SubtaskStatus[] {
  const preparedByIndex = new Map<number, PreparedSubtask>();
  const failureByIndex = new Map<number, string>();

  for (const row of prepared) preparedByIndex.set(row.index, row);
  for (const failure of failures) failureByIndex.set(failure.index, failure.message);

  return plan.subtasks.map((sub, index) => {
    const preparedRow = preparedByIndex.get(index);
    const explicitFailure = failureByIndex.get(index);
    return {
      id: preparedRow?.taskId ?? `plan-${index + 1}`,
      title: sub.title,
      state: 'error',
      branch: preparedRow?.worktreeInfo.branch ?? '',
      error: explicitFailure ?? defaultErrorMessage,
    };
  });
}

export function updateStatusFile(
  orchestratorPath: string,
  subtasks: Task[] | SubtaskStatus[],
  activityStates: Record<string, string>,
  error?: StatusError,
  merge?: MergeExecutionResult,
): void {
  try {
    fs.mkdirSync(path.join(orchestratorPath, '.dash'), { recursive: true });
    const statusPath = path.join(orchestratorPath, '.dash', 'subtask-status.json');

    let previous: Record<string, unknown> = {};
    if (fs.existsSync(statusPath)) {
      try {
        previous = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      } catch {
        // Ignore malformed previous file
      }
    }

    const statuses: SubtaskStatus[] = subtasks.map((t) => {
      if ('projectId' in t) {
        return {
          id: t.id,
          title: t.name,
          state: activityStates[t.id] ?? 'idle',
          branch: t.branch,
        };
      }
      return t;
    });

    const allDone =
      statuses.length > 0 && statuses.every((s) => s.state === 'idle' || s.state === 'ready');
    const payload: Record<string, unknown> = {
      subtasks: statuses,
      allDone,
      updatedAt: new Date().toISOString(),
    };

    const mergePayload = merge ?? (previous.merge as MergeExecutionResult | undefined);
    if (mergePayload) payload.merge = mergePayload;

    const errorPayload =
      error ?? (statuses.length === 0 ? (previous.error as StatusError | undefined) : undefined);
    if (errorPayload) payload.error = errorPayload;

    fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2));
  } catch {
    // Non-fatal
  }
}

export async function mergeSubtasks(
  orchestratorTask: Task,
  subtasks: Task[],
): Promise<MergeExecutionResult> {
  const preflight = await runMergePreflight(orchestratorTask);
  if (!preflight.ok) {
    return {
      preflight,
      results: [],
      conflicts: [],
      merged: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const results: MergeSubtaskResult[] = [];
  const conflicts: string[] = [];

  for (const subtask of subtasks) {
    let mergeTarget = subtask.branch;
    const localBranch = await runGit(orchestratorTask.path, [
      'rev-parse',
      '--verify',
      `refs/heads/${subtask.branch}`,
    ]);
    if (!localBranch.ok) {
      const remoteBranch = await runGit(orchestratorTask.path, [
        'rev-parse',
        '--verify',
        `refs/remotes/origin/${subtask.branch}`,
      ]);
      if (remoteBranch.ok) {
        mergeTarget = `origin/${subtask.branch}`;
      } else {
        results.push({
          id: subtask.id,
          title: subtask.name,
          branch: subtask.branch,
          state: 'failed',
          reason: 'branch_not_found',
        });
        continue;
      }
    }

    const alreadyMerged = await runGit(orchestratorTask.path, [
      'merge-base',
      '--is-ancestor',
      mergeTarget,
      'HEAD',
    ]);
    if (alreadyMerged.ok) {
      results.push({
        id: subtask.id,
        title: subtask.name,
        branch: subtask.branch,
        state: 'skipped',
        reason: 'already_merged',
      });
      continue;
    }
    if (alreadyMerged.code !== 1) {
      results.push({
        id: subtask.id,
        title: subtask.name,
        branch: subtask.branch,
        state: 'failed',
        reason: 'merge_base_check_failed',
        details: compactDetails([alreadyMerged.stderr]),
      });
      continue;
    }

    const mergeResult = await runGit(
      orchestratorTask.path,
      ['merge', '--no-ff', mergeTarget, '-m', `Merge subtask: ${subtask.name}`],
      60000,
    );
    if (mergeResult.ok) {
      results.push({
        id: subtask.id,
        title: subtask.name,
        branch: subtask.branch,
        state: 'merged',
      });
      continue;
    }

    const unmergedPaths = await runGit(orchestratorTask.path, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ]);
    await runGit(orchestratorTask.path, ['merge', '--abort']);

    if (unmergedPaths.stdout.trim()) {
      const files = unmergedPaths.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
      results.push({
        id: subtask.id,
        title: subtask.name,
        branch: subtask.branch,
        state: 'conflict',
        reason: 'merge_conflict',
        details: files,
      });
      conflicts.push(subtask.branch);
      continue;
    }

    results.push({
      id: subtask.id,
      title: subtask.name,
      branch: subtask.branch,
      state: 'failed',
      reason: 'merge_failed',
      details: compactDetails([mergeResult.stderr]),
    });
  }

  return {
    preflight,
    results,
    conflicts,
    merged: results.filter((r) => r.state === 'merged').length,
    skipped: results.filter((r) => r.state === 'skipped').length,
    failed: results.filter((r) => r.state === 'failed' || r.state === 'conflict').length,
  };
}

async function runMergePreflight(orchestratorTask: Task): Promise<MergePreflight> {
  const branch = await runGit(orchestratorTask.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) {
    return {
      ok: false,
      reason: 'head_check_failed',
      details: compactDetails([branch.stderr]),
    };
  }

  const currentBranch = branch.stdout.trim();
  if (currentBranch !== orchestratorTask.branch) {
    return {
      ok: false,
      reason: 'wrong_branch',
      details: [`expected=${orchestratorTask.branch}`, `actual=${currentBranch}`],
    };
  }

  const dirty = await runGit(orchestratorTask.path, ['status', '--porcelain']);
  if (!dirty.ok) {
    return {
      ok: false,
      reason: 'status_failed',
      details: compactDetails([dirty.stderr]),
    };
  }
  if (dirty.stdout.trim()) {
    return {
      ok: false,
      reason: 'dirty_worktree',
      details: compactDetails(dirty.stdout.split('\n').slice(0, 20)),
    };
  }

  const unmerged = await runGit(orchestratorTask.path, ['diff', '--name-only', '--diff-filter=U']);
  if (unmerged.stdout.trim()) {
    return {
      ok: false,
      reason: 'unmerged_paths',
      details: compactDetails(unmerged.stdout.split('\n').slice(0, 20)),
    };
  }

  return { ok: true };
}

async function runGit(
  cwd: string,
  args: string[],
  timeout = 30000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code?: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, timeout });
    return {
      ok: true,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      code: 0,
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr:
        typeof err.stderr === 'string'
          ? err.stderr
          : error instanceof Error
            ? error.message
            : String(error),
      code: typeof err.code === 'number' ? err.code : undefined,
    };
  }
}

function compactDetails(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20);
}

function formatSubtaskPrompt(sub: SubtaskDefinition): string {
  let prompt = `TASK:\n${sub.description.trim()}\n\n`;
  if (sub.focusFiles && sub.focusFiles.length > 0) {
    prompt += `FOCUS FILES (primary areas to work in):\n${sub.focusFiles.join('\n')}\n\n`;
  }
  prompt += `NOTE: You are a subagent. Complete your specific task and commit your changes.\n`;
  return prompt;
}

function normalizeProvider(raw: string | undefined, fallback: string): string {
  if (raw === 'claude' || raw === 'gemini' || raw === 'codex') return raw;
  if (fallback === 'claude' || fallback === 'gemini' || fallback === 'codex') return fallback;
  return 'claude';
}

function validateSubtaskPlan(input: unknown): PlanValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: { code: 'invalid_plan', message: 'Plan must be a JSON object' },
    };
  }

  const subtasksRaw = (input as { subtasks?: unknown }).subtasks;
  if (!Array.isArray(subtasksRaw)) {
    return {
      ok: false,
      error: { code: 'invalid_plan', message: 'Plan must contain a `subtasks` array' },
    };
  }

  if (subtasksRaw.length < 1 || subtasksRaw.length > 8) {
    return {
      ok: false,
      error: {
        code: 'invalid_plan',
        message: 'Plan must contain between 1 and 8 subtasks',
      },
    };
  }

  const errors: string[] = [];
  const seenTitles = new Set<string>();
  const subtasks: SubtaskDefinition[] = [];

  for (let i = 0; i < subtasksRaw.length; i++) {
    const item = subtasksRaw[i];
    const prefix = `subtasks[${i}]`;

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const raw = item as {
      title?: unknown;
      provider?: unknown;
      description?: unknown;
      focusFiles?: unknown;
    };

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';

    if (!title) errors.push(`${prefix}.title is required`);
    if (!description) errors.push(`${prefix}.description is required`);
    if (provider !== 'claude' && provider !== 'gemini' && provider !== 'codex') {
      errors.push(`${prefix}.provider must be one of: claude, gemini, codex`);
    }

    const dedupeKey = title.toLowerCase();
    if (title && seenTitles.has(dedupeKey)) {
      errors.push(`${prefix}.title must be unique (duplicate: "${title}")`);
    }
    if (title) seenTitles.add(dedupeKey);

    let focusFiles: string[] | undefined;
    if (raw.focusFiles !== undefined) {
      if (!Array.isArray(raw.focusFiles)) {
        errors.push(`${prefix}.focusFiles must be an array of strings when provided`);
      } else {
        const normalized: string[] = [];
        for (let j = 0; j < raw.focusFiles.length; j++) {
          const ff = raw.focusFiles[j];
          if (typeof ff !== 'string' || ff.trim().length === 0) {
            errors.push(`${prefix}.focusFiles[${j}] must be a non-empty string`);
            continue;
          }
          normalized.push(ff.trim());
        }
        focusFiles = normalized;
      }
    }

    subtasks.push({
      title,
      provider,
      description,
      ...(focusFiles && focusFiles.length > 0 ? { focusFiles } : {}),
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_plan',
        message: 'Subtask plan validation failed',
        details: errors,
      },
    };
  }

  return { ok: true, plan: { subtasks } };
}
