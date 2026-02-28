import { ipcMain } from 'electron';
import { DatabaseService } from '../services/DatabaseService';
import { mergeSubtasks, updateStatusFile } from '../services/OrchestratorService';

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
      updateStatusFile(orchestratorTask.path, subtasks, {}, undefined, result);
      return { success: true, data: result };
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
}
