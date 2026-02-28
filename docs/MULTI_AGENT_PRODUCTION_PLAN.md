# Multi-Agent Orchestration: MVP → Production Plan

## Status (nu)

MVP fungerer end-to-end:

- Orchestrator prompt-injection og planfil (`.dash/subtasks.json`)
- Subtask spawning + worktrees + DB relation (`orchestrator_task_id`)
- Statusfil (`.dash/subtask-status.json`)
- Subtask UI (nested i sidebar + orchestrator-panel + merge-knap)
- Sekventiel merge med konflikt-rapportering
- Auto-start af nye subtasks ved spawn-event

## Fundne gaps i nuværende implementation

### 1) Robusthed og determinisme

- Plan parsing/spawn fejler "silent" i flere paths (f.eks. `catch {}`), så failures er svære at debugge.
- Spawning er ikke transaktionel: delvise subtasks kan opstå ved fejl midt i loop.
- Merge-flow har ingen preflight checks (dirty working tree, branch-state, rebased branches, duplicate merge-commit prevention).

### 2) Runtime-lifecycle

- Watcher-lifecycle er process-lokal og event-baseret; orchestration state recovery efter app-restart er begrænset.
- Statusopdatering afhænger af renderer-loop i stedet for central service i main-process.

### 3) Data-integritet

- FK er nu håndhævet for `orchestrator_task_id`, men der mangler også indeks for hurtigere opslag på subtasks.
- Mangler eksplicit model for orchestration-run state (planned/spawning/running/merging/failed/done).

### 4) Sikkerhed/validering

- `subtasks.json` schema valideres ikke strengt (provider, max antal subtasks, længder, tomme felter, duplikater).
- Ingen guardrails mod farlige eller urealistiske planer (f.eks. for mange subtasks eller overlap i fokusområder).

### 5) Observability

- Ingen struktureret audit-log for orchestration events.
- Ingen metrics for spawn-latency, success-rate, merge-conflict-rate, eller time-to-done.

### 6) Test og release-kvalitet

- Ingen dedikerede tests for orchestrator-flow (unit/integration/e2e).
- Ingen chaos-/recovery-tests (crash under spawn/merge, corrupted JSON, git-fejl).

## Produktionsplan (prioriteret)

## Fase P0 (1-2 uger): Hardening + correctness

Mål: gøre MVP stabil og forudsigelig uden større arkitekturskift.

1. Strikt plan-validering

- Indfør runtime schema (fx Zod) for `.dash/subtasks.json`.
- Regler: 1-8 subtasks, gyldig provider, non-empty title/description, dedupe titles.
- Returnér/vis valideringsfejl i UI + statusfil.

2. Transaktionel spawn + kompensation

- Kør DB writes i transaction.
- Ved fejl: rollback DB og cleanup worktrees for fejlede subtasks.
- Gem per-subtask fejlstate i statusfil.

3. Merge preflight + idempotens

- Preflight: clean worktree, branch exists, no unmerged paths.
- Skip allerede merged branches (detektér via merge-base / rev-list).
- Gem merge-resultat pr. subtask (merged/skipped/conflict/failed).

4. DB forbedringer

- Tilføj index på `tasks(orchestrator_task_id)`.
- Tilføj migration/versioneret markør for orchestration schema.

Acceptance criteria P0:

- Ingen silent failure ved invalid plan.
- Spawn giver enten fuld succes eller kontrolleret partial state med tydelig fejlrapport.
- Merge kan genkøres sikkert uden dobbelt-merge.

## Fase P1 (2-4 uger): Lifecycle + UX

Mål: pålidelig drift gennem restarts og bedre operatørkontrol.

1. Main-process orchestrator runtime

- Flyt status-update loop fra renderer til main-service.
- Persistér orchestration-run state i DB (run-id + state-machine).

2. Recovery ved app-restart

- Re-hydrér aktive orchestrator-runs ved startup.
- Reconnect watchers og status-pipeline automatisk.

3. Orchestrator UI udbygning

- Vis run-state tidslinje (planned/spawning/running/merging/failed/done).
- Knapper: retry failed subtask, cancel subtask, regenerate plan.
- Konfliktpanel med kommandoer/links til konfliktfiler.

4. Policy controls

- Project-level settings: max subtasks, allowed providers, auto-merge policy.

Acceptance criteria P1:

- Orchestrator-run fortsætter korrekt over app-restart.
- Bruger kan retry/cancel uden manuel DB/git oprydning.
- UI viser tydelig og konsistent run-status.

## Fase P2 (4-8 uger): Production ops + scale

Mål: driftsklar platform med målinger, alarms og sikkerhed.

1. Observability

- Strukturerede events (`orchestrator.plan.received`, `subtask.spawned`, `merge.conflict`, osv.).
- Metrics dashboard: success-rate, conflict-rate, median completion time.
- Error reporting med correlation id pr. orchestration run.

2. Teststrategi

- Unit tests: plan validator, status aggregator, merge decision logic.
- Integration tests: spawn + merge flows med mock git.
- E2E tests: fuld orchestration med 2-3 subtasks inkl. konflikt-scenarie.

3. Performance + concurrency

- Bounded parallelism for spawn/start.
- Queue/backpressure når mange orchestrators kører samtidig.
- Timeouts + retry policy for git/CLI operationer.

4. Security og governance

- Provider allowlist per project/workspace.
- Policy for hvilke paths subtasks må ændre (soft/hard enforcement).
- Audit trail for alle automatisk triggere handlinger.

Acceptance criteria P2:

- Målbar SLA/SLO for orchestration pipeline.
- Reproducerbar testpakke i CI med høj dækning af fejlscenarier.
- Klar operations playbook for incidents.

## Konkrete næste 10 tickets

1. Add Zod validation for `.dash/subtasks.json` + error propagation to status file.
2. Add `idx_tasks_orchestrator_task_id` migration + query optimization.
3. Wrap subtask spawn in DB transaction + worktree cleanup compensation.
4. Add merge preflight checks and skip-already-merged logic.
5. Persist orchestration run table (`orchestrator_runs`, `orchestrator_events`).
6. Move status aggregation from renderer to main-process service.
7. Add restart recovery for active orchestrator runs.
8. Add retry/cancel endpoints + UI controls.
9. Add structured logging + correlation IDs.
10. Add integration test harness for orchestration happy-path + conflict-path.

## Release-gating forslag

- Beta flag: `multiAgentOrchestrationV2`.
- Krav før GA:
  - P0 acceptance criteria opfyldt.
  - Min. 2 ugers beta uden data-integritets-fejl.
  - E2E tests i CI grøn på macOS + Linux.
