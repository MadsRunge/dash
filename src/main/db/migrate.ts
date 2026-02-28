import { getRawDb } from './client';

/**
 * Run schema migrations using raw SQL.
 * Creates tables if they don't exist.
 */
export function runMigrations(): void {
  const rawDb = getRawDb();
  if (!rawDb) throw new Error('Raw database not available');

  rawDb.pragma('foreign_keys = OFF');

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      git_remote TEXT,
      git_branch TEXT,
      base_ref TEXT,
      orchestration_max_subtasks INTEGER NOT NULL DEFAULT 5,
      orchestration_allowed_providers TEXT NOT NULL DEFAULT '["claude","gemini","codex"]',
      orchestration_auto_merge_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);`);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      ai_provider TEXT NOT NULL DEFAULT 'claude',
      status TEXT NOT NULL DEFAULT 'idle',
      use_worktree INTEGER DEFAULT 1,
      auto_approve INTEGER DEFAULT 0,
      linked_issues TEXT,
      orchestrator_task_id TEXT REFERENCES tasks(id),
      archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);`);
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_orchestrator_task_id ON tasks(orchestrator_task_id);`,
  );

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_main INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_task_id ON conversations(task_id);`);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS orchestrator_runs (
      id TEXT PRIMARY KEY,
      orchestrator_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_orchestrator_task_id ON orchestrator_runs(orchestrator_task_id);`,
  );
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_project_id ON orchestrator_runs(project_id);`,
  );
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_state ON orchestrator_runs(state);`);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS orchestrator_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES orchestrator_runs(id) ON DELETE CASCADE,
      orchestrator_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'info',
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_orchestrator_events_run_id ON orchestrator_events(run_id);`,
  );
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_orchestrator_events_orchestrator_task_id ON orchestrator_events(orchestrator_task_id);`,
  );
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_orchestrator_events_created_at ON orchestrator_events(created_at);`,
  );

  // Migrations for existing databases
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN auto_approve INTEGER DEFAULT 0`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN linked_issues TEXT`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'claude'`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN description TEXT`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN orchestrator_task_id TEXT REFERENCES tasks(id)`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(
      `ALTER TABLE projects ADD COLUMN orchestration_max_subtasks INTEGER NOT NULL DEFAULT 5`,
    );
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(
      `ALTER TABLE projects ADD COLUMN orchestration_allowed_providers TEXT NOT NULL DEFAULT '["claude","gemini","codex"]'`,
    );
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(
      `ALTER TABLE projects ADD COLUMN orchestration_auto_merge_policy TEXT NOT NULL DEFAULT 'manual'`,
    );
  } catch {
    /* already exists */
  }

  ensureOrchestratorTaskForeignKey(rawDb);

  rawDb.exec(
    `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('orchestrator_p0', CURRENT_TIMESTAMP)`,
  );
  rawDb.exec(
    `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('orchestrator_p1', CURRENT_TIMESTAMP)`,
  );

  rawDb.pragma('foreign_keys = ON');
}

function ensureOrchestratorTaskForeignKey(rawDb: NonNullable<ReturnType<typeof getRawDb>>): void {
  const hasOrchestratorColumn = rawDb
    .prepare(`SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'orchestrator_task_id' LIMIT 1`)
    .get() as { 1?: number } | undefined;
  if (!hasOrchestratorColumn) return;

  const hasForeignKey = rawDb
    .prepare(
      `SELECT 1 FROM pragma_foreign_key_list('tasks') WHERE "from" = 'orchestrator_task_id' LIMIT 1`,
    )
    .get() as { 1?: number } | undefined;
  if (hasForeignKey) return;

  rawDb.exec(`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      ai_provider TEXT NOT NULL DEFAULT 'claude',
      status TEXT NOT NULL DEFAULT 'idle',
      use_worktree INTEGER DEFAULT 1,
      auto_approve INTEGER DEFAULT 0,
      linked_issues TEXT,
      orchestrator_task_id TEXT REFERENCES tasks(id),
      archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`
    INSERT INTO tasks_new (
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
    )
    SELECT
      t.id,
      t.project_id,
      t.name,
      t.description,
      t.branch,
      t.path,
      t.ai_provider,
      t.status,
      t.use_worktree,
      t.auto_approve,
      t.linked_issues,
      CASE
        WHEN t.orchestrator_task_id IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM tasks parent WHERE parent.id = t.orchestrator_task_id) THEN t.orchestrator_task_id
        ELSE NULL
      END,
      t.archived_at,
      t.created_at,
      t.updated_at
    FROM tasks t;
  `);

  rawDb.exec(`DROP TABLE tasks;`);
  rawDb.exec(`ALTER TABLE tasks_new RENAME TO tasks;`);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);`);
  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_orchestrator_task_id ON tasks(orchestrator_task_id);`,
  );
}
