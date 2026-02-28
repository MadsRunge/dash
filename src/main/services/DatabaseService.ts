import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { initDb, getDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { projects, tasks, conversations, orchestratorRuns, orchestratorEvents } from '../db/schema';
import type {
  Project,
  Task,
  Conversation,
  OrchestratorRun,
  OrchestratorRunState,
  OrchestratorEvent,
} from '@shared/types';

export class DatabaseService {
  private static initialized = false;

  static initialize(): void {
    if (this.initialized) return;

    initDb();
    runMigrations();
    this.initialized = true;
  }

  // ── Projects ─────────────────────────────────────────────

  static getProjects(): Project[] {
    const db = getDb();
    const rows = db.select().from(projects).all();
    return rows.map(this.mapProject);
  }

  static saveProject(data: Partial<Project> & { name: string; path: string }): Project {
    const db = getDb();
    const id = data.id || randomUUID();
    const now = new Date().toISOString();
    const existingRow = db.select().from(projects).where(eq(projects.id, id)).all()[0];
    const existingPolicy = existingRow ? this.mapProject(existingRow) : null;
    const providers = sanitizeProviders(
      data.orchestrationAllowedProviders ?? existingPolicy?.orchestrationAllowedProviders,
    );
    const maxSubtasks = sanitizeMaxSubtasks(
      data.orchestrationMaxSubtasks ?? existingPolicy?.orchestrationMaxSubtasks,
    );
    const autoMergePolicy =
      (data.orchestrationAutoMergePolicy ?? existingPolicy?.orchestrationAutoMergePolicy) ===
      'when_all_done'
        ? 'when_all_done'
        : 'manual';

    db.insert(projects)
      .values({
        id,
        name: data.name,
        path: data.path,
        gitRemote: data.gitRemote ?? null,
        gitBranch: data.gitBranch ?? null,
        baseRef: data.baseRef ?? null,
        orchestrationMaxSubtasks: maxSubtasks,
        orchestrationAllowedProviders: JSON.stringify(providers),
        orchestrationAutoMergePolicy: autoMergePolicy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: data.name,
          path: data.path,
          gitRemote: data.gitRemote ?? null,
          gitBranch: data.gitBranch ?? null,
          baseRef: data.baseRef ?? null,
          orchestrationMaxSubtasks: maxSubtasks,
          orchestrationAllowedProviders: JSON.stringify(providers),
          orchestrationAutoMergePolicy: autoMergePolicy,
          updatedAt: now,
        },
      })
      .run();

    const rows = db.select().from(projects).where(eq(projects.id, id)).all();
    return this.mapProject(rows[0]);
  }

  static deleteProject(id: string): void {
    const db = getDb();
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  // ── Tasks ────────────────────────────────────────────────

  static getTasks(projectId: string): Task[] {
    const db = getDb();
    const rows = db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.createdAt))
      .all();
    return rows.map(this.mapTask);
  }

  static getAllTasks(): Task[] {
    const db = getDb();
    const rows = db.select().from(tasks).all();
    return rows.map(this.mapTask);
  }

  static getTask(id: string): Task | null {
    const db = getDb();
    const rows = db.select().from(tasks).where(eq(tasks.id, id)).all();
    return rows.length > 0 ? this.mapTask(rows[0]) : null;
  }

  static saveTask(
    data: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ): Task {
    const db = getDb();
    const id = data.id || randomUUID();
    const now = new Date().toISOString();

    const linkedIssuesJson = data.linkedIssues ? JSON.stringify(data.linkedIssues) : null;

    db.insert(tasks)
      .values({
        id,
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        branch: data.branch,
        path: data.path,
        aiProvider: data.aiProvider ?? 'claude',
        status: data.status ?? 'idle',
        useWorktree: data.useWorktree ?? true,
        autoApprove: data.autoApprove ?? false,
        linkedIssues: linkedIssuesJson,
        orchestratorTaskId: data.orchestratorTaskId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          name: data.name,
          description: data.description ?? null,
          branch: data.branch,
          path: data.path,
          aiProvider: data.aiProvider ?? 'claude',
          status: data.status ?? 'idle',
          linkedIssues: linkedIssuesJson,
          orchestratorTaskId: data.orchestratorTaskId ?? null,
          updatedAt: now,
        },
      })
      .run();

    const rows = db.select().from(tasks).where(eq(tasks.id, id)).all();
    return this.mapTask(rows[0]);
  }

  static getSubtasks(orchestratorTaskId: string): Task[] {
    const db = getDb();
    const rows = db
      .select()
      .from(tasks)
      .where(eq(tasks.orchestratorTaskId, orchestratorTaskId))
      .all();
    return rows.map(this.mapTask);
  }

  static deleteSubtasks(orchestratorTaskId: string): void {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.orchestratorTaskId, orchestratorTaskId)).run();
  }

  static deleteTask(id: string): void {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }

  static archiveTask(id: string): void {
    const db = getDb();
    db.update(tasks)
      .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
  }

  static restoreTask(id: string): void {
    const db = getDb();
    db.update(tasks)
      .set({ archivedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
  }

  // ── Conversations ────────────────────────────────────────

  static getConversations(taskId: string): Conversation[] {
    const db = getDb();
    const rows = db.select().from(conversations).where(eq(conversations.taskId, taskId)).all();
    return rows.map(this.mapConversation);
  }

  static getOrCreateDefaultConversation(taskId: string): Conversation {
    const db = getDb();

    // Check if main conversation exists
    const existing = db.select().from(conversations).where(eq(conversations.taskId, taskId)).all();

    const main = existing.find((c) => c.isMain);
    if (main) return this.mapConversation(main);

    // Create default conversation
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(conversations)
      .values({
        id,
        taskId,
        title: 'Main',
        isActive: true,
        isMain: true,
        displayOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const rows = db.select().from(conversations).where(eq(conversations.id, id)).all();
    return this.mapConversation(rows[0]);
  }

  // ── Orchestrator Runs ───────────────────────────────────

  static getOrchestratorRun(id: string): OrchestratorRun | null {
    const db = getDb();
    const rows = db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, id)).all();
    return rows.length > 0 ? this.mapOrchestratorRun(rows[0]) : null;
  }

  static getLatestOrchestratorRun(orchestratorTaskId: string): OrchestratorRun | null {
    const db = getDb();
    const rows = db
      .select()
      .from(orchestratorRuns)
      .where(eq(orchestratorRuns.orchestratorTaskId, orchestratorTaskId))
      .orderBy(desc(orchestratorRuns.createdAt))
      .limit(1)
      .all();
    return rows.length > 0 ? this.mapOrchestratorRun(rows[0]) : null;
  }

  static getActiveOrchestratorRun(orchestratorTaskId: string): OrchestratorRun | null {
    const db = getDb();
    const rows = db
      .select()
      .from(orchestratorRuns)
      .where(
        and(
          eq(orchestratorRuns.orchestratorTaskId, orchestratorTaskId),
          inArray(orchestratorRuns.state, ['planned', 'spawning', 'running', 'merging']),
        ),
      )
      .orderBy(desc(orchestratorRuns.createdAt))
      .limit(1)
      .all();
    return rows.length > 0 ? this.mapOrchestratorRun(rows[0]) : null;
  }

  static listRecoverableOrchestratorRuns(): OrchestratorRun[] {
    const db = getDb();
    const rows = db
      .select()
      .from(orchestratorRuns)
      .where(inArray(orchestratorRuns.state, ['planned', 'spawning', 'running', 'merging']))
      .orderBy(desc(orchestratorRuns.updatedAt))
      .all();
    return rows.map(this.mapOrchestratorRun);
  }

  static createOrchestratorRun(data: {
    orchestratorTaskId: string;
    projectId: string;
    state?: OrchestratorRunState;
    error?: string | null;
  }): OrchestratorRun {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(orchestratorRuns)
      .values({
        id,
        orchestratorTaskId: data.orchestratorTaskId,
        projectId: data.projectId,
        state: data.state ?? 'planned',
        error: data.error ?? null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, id)).all()[0];
    return this.mapOrchestratorRun(row);
  }

  static transitionOrchestratorRun(
    id: string,
    state: OrchestratorRunState,
    error?: string | null,
  ): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.update(orchestratorRuns)
      .set({
        state,
        error: error ?? null,
        updatedAt: now,
        completedAt: state === 'failed' || state === 'done' || state === 'cancelled' ? now : null,
      })
      .where(eq(orchestratorRuns.id, id))
      .run();
  }

  static appendOrchestratorEvent(data: {
    runId: string;
    orchestratorTaskId: string;
    level?: 'info' | 'warn' | 'error';
    type: string;
    message: string;
    payload?: unknown;
  }): OrchestratorEvent {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(orchestratorEvents)
      .values({
        id,
        runId: data.runId,
        orchestratorTaskId: data.orchestratorTaskId,
        level: data.level ?? 'info',
        type: data.type,
        message: data.message,
        payload: data.payload !== undefined ? JSON.stringify(data.payload) : null,
        createdAt: now,
      })
      .run();
    const row = db.select().from(orchestratorEvents).where(eq(orchestratorEvents.id, id)).all()[0];
    return this.mapOrchestratorEvent(row);
  }

  static getOrchestratorEvents(runId: string, limit = 100): OrchestratorEvent[] {
    const db = getDb();
    const rows = db
      .select()
      .from(orchestratorEvents)
      .where(eq(orchestratorEvents.runId, runId))
      .orderBy(desc(orchestratorEvents.createdAt))
      .limit(Math.max(1, Math.min(limit, 500)))
      .all();
    return rows.map(this.mapOrchestratorEvent);
  }

  // ── Mappers ──────────────────────────────────────────────

  private static mapProject(row: typeof projects.$inferSelect): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      gitRemote: row.gitRemote,
      gitBranch: row.gitBranch,
      baseRef: row.baseRef,
      orchestrationMaxSubtasks: sanitizeMaxSubtasks(row.orchestrationMaxSubtasks ?? 5),
      orchestrationAllowedProviders: parseProviders(row.orchestrationAllowedProviders),
      orchestrationAutoMergePolicy:
        row.orchestrationAutoMergePolicy === 'when_all_done' ? 'when_all_done' : 'manual',
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapTask(row: typeof tasks.$inferSelect): Task {
    let linkedIssues: number[] | null = null;
    if (row.linkedIssues) {
      try {
        linkedIssues = JSON.parse(row.linkedIssues);
      } catch {
        // Corrupted JSON — ignore
      }
    }

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description ?? null,
      branch: row.branch,
      path: row.path,
      aiProvider: row.aiProvider,
      status: row.status,
      useWorktree: row.useWorktree ?? true,
      autoApprove: row.autoApprove ?? false,
      linkedIssues,
      orchestratorTaskId: row.orchestratorTaskId ?? null,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapConversation(row: typeof conversations.$inferSelect): Conversation {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      isActive: row.isActive ?? false,
      isMain: row.isMain ?? false,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapOrchestratorRun(row: typeof orchestratorRuns.$inferSelect): OrchestratorRun {
    return {
      id: row.id,
      orchestratorTaskId: row.orchestratorTaskId,
      projectId: row.projectId,
      state: (row.state as OrchestratorRunState) ?? 'planned',
      error: row.error ?? null,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapOrchestratorEvent(
    row: typeof orchestratorEvents.$inferSelect,
  ): OrchestratorEvent {
    return {
      id: row.id,
      runId: row.runId,
      orchestratorTaskId: row.orchestratorTaskId,
      level: row.level as 'info' | 'warn' | 'error',
      type: row.type,
      message: row.message,
      payload: row.payload ?? null,
      createdAt: row.createdAt ?? '',
    };
  }
}

function parseProviders(raw: string | null): string[] {
  if (!raw) return ['claude', 'gemini', 'codex'];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const next = parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value === 'claude' || value === 'gemini' || value === 'codex');
      if (next.length > 0) return Array.from(new Set(next));
    }
  } catch {
    // Ignore malformed data
  }
  return ['claude', 'gemini', 'codex'];
}

function sanitizeProviders(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return ['claude', 'gemini', 'codex'];
  const next = raw
    .map((value) => value.trim())
    .filter((value) => value === 'claude' || value === 'gemini' || value === 'codex');
  return next.length > 0 ? Array.from(new Set(next)) : ['claude', 'gemini', 'codex'];
}

function sanitizeMaxSubtasks(raw: number | undefined): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 5;
  const rounded = Math.round(raw);
  return Math.max(1, Math.min(8, rounded));
}
