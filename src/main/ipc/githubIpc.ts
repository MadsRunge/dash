import { ipcMain } from 'electron';
import { GithubService } from '../services/GithubService';

export function registerGithubIpc(): void {
  ipcMain.handle('github:check-available', async () => {
    try {
      const available = await GithubService.isAvailable();
      return { success: true, data: available };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('github:search-issues', async (_event, args: { cwd: string; query: string }) => {
    try {
      const issues = await GithubService.searchIssues(args.cwd, args.query);
      return { success: true, data: issues };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('github:get-issue', async (_event, args: { cwd: string; number: number }) => {
    try {
      const issue = await GithubService.getIssue(args.cwd, args.number);
      return { success: true, data: issue };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'github:post-branch-comment',
    async (_event, args: { cwd: string; issueNumber: number; branch: string }) => {
      try {
        await GithubService.postBranchComment(args.cwd, args.issueNumber, args.branch);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'github:link-branch',
    async (_event, args: { cwd: string; issueNumber: number; branch: string }) => {
      try {
        await GithubService.linkBranch(args.cwd, args.issueNumber, args.branch);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'github:create-issue',
    async (
      _event,
      args: { cwd: string; title: string; body?: string; labels?: string[]; assignees?: string[] },
    ) => {
      try {
        const issue = await GithubService.createIssue(
          args.cwd,
          args.title,
          args.body,
          args.labels,
          args.assignees,
        );
        return { success: true, data: issue };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'github:list-all-issues',
    async (_event, args: { cwd: string; state?: string }) => {
      try {
        const issues = await GithubService.listAllIssues(args.cwd, args.state);
        return { success: true, data: issues };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('github:list-labels', async (_event, args: { cwd: string }) => {
    try {
      const labels = await GithubService.listLabels(args.cwd);
      return { success: true, data: labels };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
