import React from 'react';
import { AlertTriangle, GitMerge, Loader2, Network, RefreshCw, Square } from 'lucide-react';
import type { ActivityState, Task } from '../../shared/types';

interface RunEvent {
  id: string;
  level: 'info' | 'warn' | 'error';
  type: string;
  message: string;
  createdAt: string;
}

interface MergeResult {
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
}

interface OrchestratorPanelProps {
  orchestratorTask: Task;
  subtasks: Task[];
  taskActivity: Record<string, ActivityState>;
  isMerging: boolean;
  conflicts: string[];
  runState?: string | null;
  runEvents?: RunEvent[];
  statusError?: { code: string; message: string; details?: string[] } | null;
  mergeResult?: MergeResult | null;
  onMerge: (orchestratorTaskId: string) => void;
  onRetrySubtask?: (orchestratorTaskId: string, subtaskId: string) => void;
  onCancelSubtask?: (orchestratorTaskId: string, subtaskId: string) => void;
  onRegeneratePlan?: (orchestratorTaskId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onOpenConflictFile?: (filePath: string) => void;
}

function isIdleLike(state: ActivityState | undefined): boolean {
  return state === 'idle' || state === 'ready';
}

function stateDotClass(state: ActivityState | undefined): string {
  if (state === 'error' || state === 'auth_required') return 'bg-red-500';
  if (state === 'awaiting_input' || state === 'waiting') return 'bg-orange-500';
  if (state === 'streaming' || state === 'busy') return 'bg-amber-400 status-pulse';
  if (state === 'booting') return 'bg-blue-400';
  return 'bg-emerald-400';
}

function runStateClass(state: string | null | undefined): string {
  if (state === 'failed' || state === 'cancelled')
    return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (state === 'merging') return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  if (state === 'done') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (state === 'spawning' || state === 'planned') {
    return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  }
  return 'text-foreground/70 bg-accent/40 border-border/60';
}

function hasConflictEntries(mergeResult: MergeResult | null | undefined): boolean {
  if (!mergeResult) return false;
  return mergeResult.results.some(
    (result) => result.state === 'conflict' && (result.details?.length ?? 0) > 0,
  );
}

export function OrchestratorPanel({
  orchestratorTask,
  subtasks,
  taskActivity,
  isMerging,
  conflicts,
  runState,
  runEvents = [],
  statusError,
  mergeResult,
  onMerge,
  onRetrySubtask,
  onCancelSubtask,
  onRegeneratePlan,
  onSelectTask,
  onOpenConflictFile,
}: OrchestratorPanelProps) {
  const doneCount = subtasks.filter((task) => isIdleLike(taskActivity[task.id])).length;
  const allIdle = subtasks.length > 0 && doneCount === subtasks.length;
  const timeline = runEvents.slice(-5);

  return (
    <div className="px-4 py-3 border-b border-border/40 bg-accent/20 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Network size={14} strokeWidth={1.8} className="text-primary flex-shrink-0" />
          <span className="text-[12px] text-foreground/80 truncate">
            Orchestrator: {orchestratorTask.name}
          </span>
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {doneCount}/{subtasks.length} done
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${runStateClass(runState)}`}
          >
            {runState ?? 'idle'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onRegeneratePlan?.(orchestratorTask.id)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-border/60 text-foreground/70 hover:bg-accent/60 transition-colors"
            title="Regenerate plan from .dash/subtasks.json"
          >
            <RefreshCw size={11} strokeWidth={1.8} />
            <span>Regenerate</span>
          </button>
          <button
            onClick={() => onMerge(orchestratorTask.id)}
            disabled={!allIdle || isMerging}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 text-foreground/80 hover:bg-accent/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={
              isMerging
                ? 'Merging in progress...'
                : !allIdle && subtasks.some((t) => taskActivity[t.id] === 'error')
                  ? 'Some subtasks have errors - retry or cancel them first'
                  : !allIdle
                    ? 'Waiting for all subtasks to finish'
                    : undefined
            }
          >
            {isMerging ? (
              <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <GitMerge size={12} strokeWidth={1.8} />
            )}
            <span>{isMerging ? 'Merging...' : 'Merge subtasks'}</span>
          </button>
        </div>
      </div>

      {timeline.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5">
          {timeline.map((event) => (
            <div
              key={event.id}
              className={`text-[10px] px-2 py-1 rounded-md border whitespace-nowrap ${
                event.level === 'error'
                  ? 'bg-red-500/10 border-red-500/20 text-red-300'
                  : event.level === 'warn'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-200'
                    : 'bg-accent/40 border-border/50 text-foreground/70'
              }`}
              title={new Date(event.createdAt).toLocaleString()}
            >
              {event.message}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {subtasks.map((task) => {
          const state = taskActivity[task.id];
          return (
            <div
              key={task.id}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
            >
              <button
                onClick={() => onSelectTask?.(task.id)}
                className="flex items-center gap-2 text-left flex-1 min-w-0"
              >
                <div
                  className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${stateDotClass(state)}`}
                />
                <span className="text-[12px] text-foreground/80 truncate flex-1">{task.name}</span>
                <span className="text-[10px] text-muted-foreground/70">{state ?? 'idle'}</span>
              </button>

              <button
                onClick={() => onRetrySubtask?.(orchestratorTask.id, task.id)}
                disabled={state === 'streaming' || state === 'busy' || state === 'booting'}
                className="text-[10px] px-1.5 py-1 rounded border border-border/60 text-foreground/70 hover:bg-accent/70 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Retry
              </button>
              <button
                onClick={() => onCancelSubtask?.(orchestratorTask.id, task.id)}
                disabled={state === undefined || isIdleLike(state)}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border border-border/60 text-foreground/60 hover:bg-accent/70 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Square size={9} strokeWidth={2} />
                <span>Cancel</span>
              </button>
            </div>
          );
        })}
      </div>

      {statusError && (
        <div className="px-2 py-2 rounded-md bg-red-500/10 border border-red-500/20">
          <div className="text-[11px] text-red-300">{statusError.message}</div>
          {statusError.details && statusError.details.length > 0 && (
            <div className="text-[10px] text-red-200/90 mt-1 break-words">
              {statusError.details.join(' | ')}
            </div>
          )}
        </div>
      )}

      {(conflicts.length > 0 || hasConflictEntries(mergeResult)) && (
        <div className="mt-2 flex items-start gap-2 px-2 py-2 rounded-md bg-red-500/10 border border-red-500/20">
          <AlertTriangle
            size={13}
            strokeWidth={1.8}
            className="text-red-400 mt-0.5 flex-shrink-0"
          />
          <div className="min-w-0 w-full">
            <div className="text-[11px] text-red-300 mb-1">Merge conflicts</div>
            {conflicts.length > 0 && (
              <div className="text-[10px] text-red-200/90 break-all mb-1">
                Branches: {conflicts.join(', ')}
              </div>
            )}
            {mergeResult?.results
              .filter((result) => result.state === 'conflict' && (result.details?.length ?? 0) > 0)
              .map((result) => (
                <div key={result.id} className="mb-1.5">
                  <div className="text-[10px] text-red-200/90 mb-0.5">{result.title}</div>
                  <div className="flex flex-wrap gap-1">
                    {(result.details ?? []).map((file) => (
                      <button
                        key={`${result.id}:${file}`}
                        onClick={() => onOpenConflictFile?.(file)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/30 hover:bg-red-500/20 text-red-100"
                        title={`Open ${file}`}
                      >
                        {file}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            <div className="text-[10px] text-red-200/90">
              Commands: git status, fix files, git add [file], git commit
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
