import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    gitRemote: text('git_remote'),
    gitBranch: text('git_branch'),
    baseRef: text('base_ref'),
    orchestrationMaxSubtasks: integer('orchestration_max_subtasks').notNull().default(5),
    orchestrationAllowedProviders: text('orchestration_allowed_providers')
      .notNull()
      .default('["claude","gemini","codex"]'),
    orchestrationAutoMergePolicy: text('orchestration_auto_merge_policy')
      .notNull()
      .default('manual'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pathIdx: uniqueIndex('idx_projects_path').on(table.path),
  }),
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    branch: text('branch').notNull(),
    path: text('path').notNull(),
    aiProvider: text('ai_provider').notNull().default('claude'),
    status: text('status').notNull().default('idle'),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).default(true),
    autoApprove: integer('auto_approve', { mode: 'boolean' }).default(false),
    linkedIssues: text('linked_issues'),
    orchestratorTaskId: text('orchestrator_task_id').references((): AnySQLiteColumn => tasks.id),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
    orchestratorTaskIdIdx: index('idx_tasks_orchestrator_task_id').on(table.orchestratorTaskId),
  }),
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_conversations_task_id').on(table.taskId),
  }),
);

export const orchestratorRuns = sqliteTable(
  'orchestrator_runs',
  {
    id: text('id').primaryKey(),
    orchestratorTaskId: text('orchestrator_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    error: text('error'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    orchestratorTaskIdx: index('idx_orchestrator_runs_orchestrator_task_id').on(
      table.orchestratorTaskId,
    ),
    projectIdx: index('idx_orchestrator_runs_project_id').on(table.projectId),
    stateIdx: index('idx_orchestrator_runs_state').on(table.state),
  }),
);

export const orchestratorEvents = sqliteTable(
  'orchestrator_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => orchestratorRuns.id, { onDelete: 'cascade' }),
    orchestratorTaskId: text('orchestrator_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    level: text('level').notNull().default('info'),
    type: text('type').notNull(),
    message: text('message').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    runIdx: index('idx_orchestrator_events_run_id').on(table.runId),
    taskIdx: index('idx_orchestrator_events_orchestrator_task_id').on(table.orchestratorTaskId),
    createdIdx: index('idx_orchestrator_events_created_at').on(table.createdAt),
  }),
);
