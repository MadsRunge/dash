import { ipcMain } from 'electron';
import { DatabaseService } from '../services/DatabaseService';
import {
  mergeSubtasks,
  readStatusFile,
  regeneratePlan,
  updateStatusFile,
} from '../services/OrchestratorService';
import { killPty, startDirectPty, writeTaskContext } from '../services/ptyManager';
import { orchestratorRuntimeService } from '../services/OrchestratorRuntimeService';

export function registerOrchestratorIpc(): void {
  ipcMain.handle('orchestrator:getSubtasks', (_event, orchestratorTaskId: string) => {
    try {
      const subtasks = DatabaseService.getSubtasks(orchestratorTaskId);
      return { success: true, data: subtasks };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('orchestrator:mergeSubtasks', async (_event, orchestratorTaskId: string) => {
    try {
      const orchestratorTask = DatabaseService.getTask(orchestratorTaskId);
      if (!orchestratorTask) throw new Error('Orchestrator task not found');

      const subtasks = DatabaseService.getSubtasks(orchestratorTaskId);
      if (subtasks.length === 0) throw new Error('No subtasks found');

      const result = await mergeSubtasks(orchestratorTask, subtasks);
      const run =
        DatabaseService.getActiveOrchestratorRun(orchestratorTaskId) ??
        DatabaseService.getLatestOrchestratorRun(orchestratorTaskId);
      updateStatusFile(
        orchestratorTask.path,
        subtasks,
        {},
        undefined,
        result,
        run ? { id: run.id, state: run.state } : undefined,
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('orchestrator:getRun', (_event, orchestratorTaskId: string) => {
    try {
      const run =
        DatabaseService.getActiveOrchestratorRun(orchestratorTaskId) ??
        DatabaseService.getLatestOrchestratorRun(orchestratorTaskId);
      if (!run) return { success: true, data: null };

      const task = DatabaseService.getTask(orchestratorTaskId);
      const status = task ? readStatusFile(task.path) : null;
      const events = DatabaseService.getOrchestratorEvents(run.id, 100).reverse();
      return { success: true, data: { run, status, events } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('orchestrator:getStatus', (_event, orchestratorTaskId: string) => {
    try {
      const orchestratorTask = DatabaseService.getTask(orchestratorTaskId);
      if (!orchestratorTask) return { success: false, error: 'Task not found' };
      return { success: true, data: readStatusFile(orchestratorTask.path) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'orchestrator:updateStatus',
    (_event, orchestratorTaskId: string, activityStates: Record<string, string>) => {
      try {
        const orchestratorTask = DatabaseService.getTask(orchestratorTaskId);
        if (!orchestratorTask) return { success: false, error: 'Task not found' };
        const subtasks = DatabaseService.getSubtasks(orchestratorTaskId);
        updateStatusFile(orchestratorTask.path, subtasks, activityStates);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'orchestrator:retrySubtask',
    async (
      event,
      args: { orchestratorTaskId: string; subtaskId: string; cols?: number; rows?: number },
    ) => {
      try {
        const orchestratorTask = DatabaseService.getTask(args.orchestratorTaskId);
        if (!orchestratorTask) throw new Error('Orchestrator task not found');
        const subtask = DatabaseService.getTask(args.subtaskId);
        if (!subtask || subtask.orchestratorTaskId !== orchestratorTask.id) {
          throw new Error('Subtask not found');
        }

        if (subtask.aiProvider === 'claude') {
          const prompt = subtask.description?.trim() || `Task: ${subtask.name}`;
          writeTaskContext(subtask.id, subtask.path, prompt, { issueNumbers: [] }, false);
        }

        const result = await startDirectPty({
          id: subtask.id,
          cwd: subtask.path,
          cols: args.cols ?? 120,
          rows: args.rows ?? 30,
          autoApprove: subtask.autoApprove,
          sender: event.sender,
        });

        const run = DatabaseService.getActiveOrchestratorRun(orchestratorTask.id);
        if (run) {
          DatabaseService.transitionOrchestratorRun(run.id, 'running');
          DatabaseService.appendOrchestratorEvent({
            runId: run.id,
            orchestratorTaskId: orchestratorTask.id,
            type: 'subtask.retry',
            message: `Retried subtask: ${subtask.name}`,
            payload: { subtaskId: subtask.id },
          });
        }

        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'orchestrator:cancelSubtask',
    (_event, args: { orchestratorTaskId: string; subtaskId: string }) => {
      try {
        const orchestratorTask = DatabaseService.getTask(args.orchestratorTaskId);
        if (!orchestratorTask) throw new Error('Orchestrator task not found');
        const subtask = DatabaseService.getTask(args.subtaskId);
        if (!subtask || subtask.orchestratorTaskId !== orchestratorTask.id) {
          throw new Error('Subtask not found');
        }

        killPty(subtask.id);

        const run = DatabaseService.getActiveOrchestratorRun(orchestratorTask.id);
        if (run) {
          DatabaseService.appendOrchestratorEvent({
            runId: run.id,
            orchestratorTaskId: orchestratorTask.id,
            type: 'subtask.cancel',
            message: `Cancelled subtask: ${subtask.name}`,
            payload: { subtaskId: subtask.id },
          });
        }

        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('orchestrator:regeneratePlan', async (event, orchestratorTaskId: string) => {
    try {
      const orchestratorTask = DatabaseService.getTask(orchestratorTaskId);
      if (!orchestratorTask) return { success: false, error: 'Orchestrator task not found' };
      const project =
        DatabaseService.getProjects().find((entry) => entry.id === orchestratorTask.projectId) ??
        null;
      if (!project) return { success: false, error: 'Project not found' };

      const result = await regeneratePlan(orchestratorTask, project, (subtasks) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('orchestrator:subtasksSpawned', { orchestratorTaskId, subtasks });
        }
      });
      if (!result.ok)
        return { success: false, error: result.message ?? 'Failed to regenerate plan' };

      await orchestratorRuntimeService.recoverActiveRuns();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
