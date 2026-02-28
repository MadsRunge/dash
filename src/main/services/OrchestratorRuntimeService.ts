import * as fs from 'fs';
import * as path from 'path';
import type { WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { DatabaseService } from './DatabaseService';
import { mergeSubtasks, startWatching, updateStatusFile } from './OrchestratorService';
import type { ActivityState, OrchestratorRun, Project, Task } from '../../shared/types';

const IDLE_STATES = new Set<ActivityState>(['idle', 'ready']);

function isIdleLike(state: ActivityState | undefined): boolean {
  return !!state && IDLE_STATES.has(state);
}

class OrchestratorRuntimeService {
  private sender: WebContents | null = null;
  private started = false;
  private unsubscribeActivity: (() => void) | null = null;
  private autoMergeInFlight = new Set<string>();

  start(): void {
    if (this.started) return;
    this.started = true;

    this.unsubscribeActivity = activityMonitor.onChange((snapshot) => {
      void this.handleActivitySnapshot(snapshot);
    });

    void this.recoverActiveRuns();
  }

  stop(): void {
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
      this.unsubscribeActivity = null;
    }
    this.sender = null;
    this.started = false;
    this.autoMergeInFlight.clear();
  }

  setSender(sender: WebContents | null): void {
    this.sender = sender;
    if (sender) {
      void this.recoverActiveRuns();
    }
  }

  async recoverActiveRuns(): Promise<void> {
    const runs = dedupeRuns(DatabaseService.listRecoverableOrchestratorRuns());
    const snapshot = activityMonitor.getAll();

    for (const run of runs) {
      const orchestratorTask = DatabaseService.getTask(run.orchestratorTaskId);
      if (!orchestratorTask) {
        DatabaseService.transitionOrchestratorRun(run.id, 'failed', 'Orchestrator task missing');
        continue;
      }
      if (orchestratorTask.orchestratorTaskId) continue;

      const project =
        DatabaseService.getProjects().find((p) => p.id === orchestratorTask.projectId) ?? null;
      if (!project) {
        DatabaseService.transitionOrchestratorRun(run.id, 'failed', 'Project missing');
        continue;
      }

      if (run.state === 'spawning') {
        DatabaseService.transitionOrchestratorRun(
          run.id,
          'failed',
          'Application restarted during spawn; run needs retry/regenerate',
        );
        DatabaseService.appendOrchestratorEvent({
          runId: run.id,
          orchestratorTaskId: orchestratorTask.id,
          level: 'warn',
          type: 'run.recovered_after_spawn_interrupt',
          message: 'Application restarted while run was spawning',
        });
      }

      this.attachWatcher(orchestratorTask, project);

      const subtasks = DatabaseService.getSubtasks(orchestratorTask.id);
      const currentRun =
        DatabaseService.getActiveOrchestratorRun(orchestratorTask.id) ??
        DatabaseService.getLatestOrchestratorRun(orchestratorTask.id) ??
        run;
      updateStatusFile(orchestratorTask.path, subtasks, snapshot, undefined, undefined, {
        id: currentRun.id,
        state: currentRun.state,
      });

      if (subtasks.length > 0 && (run.state === 'planned' || run.state === 'spawning')) {
        DatabaseService.transitionOrchestratorRun(run.id, 'running');
      }
    }

    const allTasks = DatabaseService.getAllTasks().filter((task) => !task.orchestratorTaskId);
    for (const task of allTasks) {
      if (runs.some((run) => run.orchestratorTaskId === task.id)) continue;

      const markerPath = path.join(task.path, '.dash', 'orchestrator.json');
      const hasMarker = fs.existsSync(markerPath);
      const subtasks = DatabaseService.getSubtasks(task.id);
      if (!hasMarker && subtasks.length === 0) continue;

      const project =
        DatabaseService.getProjects().find((entry) => entry.id === task.projectId) ?? null;
      if (!project) continue;

      const run = DatabaseService.createOrchestratorRun({
        orchestratorTaskId: task.id,
        projectId: task.projectId,
        state: subtasks.length > 0 ? 'running' : 'planned',
      });
      DatabaseService.appendOrchestratorEvent({
        runId: run.id,
        orchestratorTaskId: task.id,
        type: 'run.recovered_without_active_run',
        message: 'Recovered orchestrator task without an active run record',
      });

      this.attachWatcher(task, project);
      updateStatusFile(task.path, subtasks, snapshot, undefined, undefined, {
        id: run.id,
        state: run.state,
      });
    }
  }

  private async handleActivitySnapshot(
    activityStates: Record<string, ActivityState>,
  ): Promise<void> {
    const runs = dedupeRuns(DatabaseService.listRecoverableOrchestratorRuns());

    for (const run of runs) {
      const orchestratorTask = DatabaseService.getTask(run.orchestratorTaskId);
      if (!orchestratorTask) continue;

      const subtasks = DatabaseService.getSubtasks(orchestratorTask.id);
      const currentRun =
        DatabaseService.getActiveOrchestratorRun(orchestratorTask.id) ??
        DatabaseService.getLatestOrchestratorRun(orchestratorTask.id) ??
        run;
      updateStatusFile(orchestratorTask.path, subtasks, activityStates, undefined, undefined, {
        id: currentRun.id,
        state: currentRun.state,
      });

      if (subtasks.length > 0 && (run.state === 'planned' || run.state === 'spawning')) {
        DatabaseService.transitionOrchestratorRun(run.id, 'running');
      }

      await this.maybeAutoMerge(run, orchestratorTask, subtasks, activityStates);
    }
  }

  private async maybeAutoMerge(
    run: OrchestratorRun,
    orchestratorTask: Task,
    subtasks: Task[],
    activityStates: Record<string, ActivityState>,
  ): Promise<void> {
    if (subtasks.length === 0) return;
    if (run.state === 'merging') return;
    if (this.autoMergeInFlight.has(run.id)) return;

    const project = DatabaseService.getProjects().find((p) => p.id === run.projectId) ?? null;
    if (!project || project.orchestrationAutoMergePolicy !== 'when_all_done') return;

    const allIdle = subtasks.every((task) => isIdleLike(activityStates[task.id]));
    if (!allIdle) return;

    this.autoMergeInFlight.add(run.id);
    DatabaseService.transitionOrchestratorRun(run.id, 'merging');
    DatabaseService.appendOrchestratorEvent({
      runId: run.id,
      orchestratorTaskId: orchestratorTask.id,
      type: 'run.auto_merge.started',
      message: 'Auto merge started (policy: when_all_done)',
    });

    try {
      const result = await mergeSubtasks(orchestratorTask, subtasks);
      const latestRun =
        DatabaseService.getActiveOrchestratorRun(orchestratorTask.id) ??
        DatabaseService.getLatestOrchestratorRun(orchestratorTask.id);
      updateStatusFile(
        orchestratorTask.path,
        subtasks,
        activityStates,
        undefined,
        result,
        latestRun ? { id: latestRun.id, state: latestRun.state } : undefined,
      );

      const ok = result.preflight.ok && result.failed === 0 && result.conflicts.length === 0;
      if (ok) {
        DatabaseService.transitionOrchestratorRun(run.id, 'done');
        DatabaseService.appendOrchestratorEvent({
          runId: run.id,
          orchestratorTaskId: orchestratorTask.id,
          type: 'run.auto_merge.completed',
          message: `Auto merge completed (${result.merged} merged, ${result.skipped} skipped)`,
          payload: result,
        });
      } else {
        DatabaseService.transitionOrchestratorRun(run.id, 'failed', 'Auto merge failed');
        DatabaseService.appendOrchestratorEvent({
          runId: run.id,
          orchestratorTaskId: orchestratorTask.id,
          level: 'error',
          type: 'run.auto_merge.failed',
          message: 'Auto merge failed or produced conflicts',
          payload: result,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      DatabaseService.transitionOrchestratorRun(run.id, 'failed', message);
      DatabaseService.appendOrchestratorEvent({
        runId: run.id,
        orchestratorTaskId: orchestratorTask.id,
        level: 'error',
        type: 'run.auto_merge.exception',
        message,
      });
    } finally {
      this.autoMergeInFlight.delete(run.id);
    }
  }

  private attachWatcher(orchestratorTask: Task, project: Project): void {
    startWatching(orchestratorTask, project, (subtasks) => {
      const run = ensureActiveRun(orchestratorTask);
      DatabaseService.transitionOrchestratorRun(run.id, 'running');
      DatabaseService.appendOrchestratorEvent({
        runId: run.id,
        orchestratorTaskId: orchestratorTask.id,
        type: 'subtasks.spawned',
        message: `Spawned ${subtasks.length} subtasks`,
      });

      if (this.sender && !this.sender.isDestroyed()) {
        this.sender.send('orchestrator:subtasksSpawned', {
          orchestratorTaskId: orchestratorTask.id,
          subtasks,
        });
      }
    });
  }
}

function ensureActiveRun(orchestratorTask: Task): OrchestratorRun {
  const existing = DatabaseService.getActiveOrchestratorRun(orchestratorTask.id);
  if (existing) return existing;
  return DatabaseService.createOrchestratorRun({
    orchestratorTaskId: orchestratorTask.id,
    projectId: orchestratorTask.projectId,
    state: 'planned',
  });
}

function dedupeRuns(runs: OrchestratorRun[]): OrchestratorRun[] {
  const seen = new Set<string>();
  const next: OrchestratorRun[] = [];
  for (const run of runs) {
    if (seen.has(run.orchestratorTaskId)) continue;
    seen.add(run.orchestratorTaskId);
    next.push(run);
  }
  return next;
}

export const orchestratorRuntimeService = new OrchestratorRuntimeService();
