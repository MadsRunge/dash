import React from 'react';
import { AlertTriangle, GitMerge, Network } from 'lucide-react';
import type { ActivityState, Task } from '../../shared/types';

interface OrchestratorPanelProps {
  orchestratorTask: Task;
  subtasks: Task[];
  taskActivity: Record<string, ActivityState>;
  isMerging: boolean;
  conflicts: string[];
  onMerge: (orchestratorTaskId: string) => void;
  onSelectTask?: (taskId: string) => void;
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

export function OrchestratorPanel({
  orchestratorTask,
  subtasks,
  taskActivity,
  isMerging,
  conflicts,
  onMerge,
  onSelectTask,
}: OrchestratorPanelProps) {
  const doneCount = subtasks.filter((task) => isIdleLike(taskActivity[task.id])).length;
  const allIdle = subtasks.length > 0 && doneCount === subtasks.length;

  return (
    <div className="px-4 py-3 border-b border-border/40 bg-accent/20">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Network size={14} strokeWidth={1.8} className="text-primary flex-shrink-0" />
          <span className="text-[12px] text-foreground/80 truncate">
            Orchestrator: {orchestratorTask.name}
          </span>
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {doneCount}/{subtasks.length} done
          </span>
        </div>
        <button
          onClick={() => onMerge(orchestratorTask.id)}
          disabled={!allIdle || isMerging}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 text-foreground/80 hover:bg-accent/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <GitMerge size={12} strokeWidth={1.8} />
          <span>{isMerging ? 'Merging...' : 'Merge subtasks'}</span>
        </button>
      </div>

      <div className="space-y-1">
        {subtasks.map((task) => {
          const state = taskActivity[task.id];
          return (
            <button
              key={task.id}
              onClick={() => onSelectTask?.(task.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors"
            >
              <div
                className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${stateDotClass(state)}`}
              />
              <span className="text-[12px] text-foreground/80 truncate flex-1">{task.name}</span>
              <span className="text-[10px] text-muted-foreground/70">{state ?? 'idle'}</span>
            </button>
          );
        })}
      </div>

      {conflicts.length > 0 && (
        <div className="mt-2 flex items-start gap-2 px-2 py-2 rounded-md bg-red-500/10 border border-red-500/20">
          <AlertTriangle
            size={13}
            strokeWidth={1.8}
            className="text-red-400 mt-0.5 flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="text-[11px] text-red-300 mb-0.5">Merge conflicts</div>
            <div className="text-[10px] text-red-200/90 break-all">{conflicts.join(', ')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
