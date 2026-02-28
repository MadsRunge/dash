# Multi-Agent Orchestration i Dash

## Koncept

En "orchestrated task" lader én master AI (orchestrator) nedbryde en stor opgave i subtasks og delegere dem til separate AI-sessioner — hver i sin egen worktree og terminal. Dash koordinerer det hele og merger resultatet til sidst.

Brugeren ser:

- Én orchestrator-terminal (master AI planlægger og koordinerer)
- N subtask-terminaler (en per subtask, kører parallelt)
- Et merge-trin når alle subtasks er færdige
- Én samlet branch klar til test og PR

Det unikke ved Dash's tilgang: **fuld transparens** — du kan følge med i hvad hver AI laver i sin egen terminal og gribe ind når som helst.

---

## Arkitektur

### Kommunikationsprotokol (fil-baseret)

Master AI kommunikerer med Dash via filer i `.dash/` i orchestratorens worktree:

**Master skriver → Dash læser:**

```
.dash/subtasks.json     ← Master AI definerer subtasks her
```

**Dash skriver → Master læser:**

```
.dash/subtask-status.json  ← Dash opdaterer status per subtask
```

### Subtask plan format (`.dash/subtasks.json`)

```json
{
  "subtasks": [
    {
      "title": "Implement frontend components",
      "provider": "claude",
      "description": "Full task description for the subagent...",
      "focusFiles": ["src/components/", "src/renderer/"]
    },
    {
      "title": "Implement backend API",
      "provider": "codex",
      "description": "Full task description for the subagent...",
      "focusFiles": ["src/main/services/", "src/main/ipc/"]
    }
  ]
}
```

### Status format (`.dash/subtask-status.json`)

```json
{
  "subtasks": [
    { "id": "task-123", "title": "Frontend", "state": "busy", "branch": "feat-frontend-abc" },
    { "id": "task-456", "title": "Backend", "state": "idle", "branch": "feat-backend-def" }
  ],
  "allDone": false
}
```

---

## System prompt til master AI

Master AI'en injiceres med en instruktion via `.dash/prompt.txt`:

```
[ORCHESTRATOR MODE]

You are the master coordinator for a multi-agent task in Dash.

Your workflow:
1. Analyze the task thoroughly
2. Break it into subtasks (2-5 recommended)
3. Write your subtask plan to .dash/subtasks.json (Dash will spawn agents automatically)
4. Monitor progress via .dash/subtask-status.json
5. When allDone=true, review the merged result and verify correctness

Subtask plan format:
{
  "subtasks": [
    {
      "title": "Short title",
      "provider": "claude|gemini|codex",
      "description": "Detailed instructions for the subagent",
      "focusFiles": ["optional/path/hints"]
    }
  ]
}

Write the plan to .dash/subtasks.json to begin delegation.
```

---

## Implementeringsplan

### Fase 1 — Backend & Database

**1.1 DB schema (`src/main/db/schema.ts`)**

- Tilføj `orchestratorTaskId: text('orchestrator_task_id')` til tasks-tabellen
- Tasks med `orchestratorTaskId` sat er subtasks

**1.2 Migration (`src/main/db/migrate.ts`)**

```sql
ALTER TABLE tasks ADD COLUMN orchestrator_task_id TEXT REFERENCES tasks(id);
```

**1.3 DatabaseService (`src/main/services/DatabaseService.ts`)**

- Tilføj `orchestratorTaskId` til `saveTask()` og `mapTask()`
- Tilføj `getSubtasks(orchestratorTaskId: string): Task[]`

**1.4 Shared types (`src/shared/types.ts`)**

- Tilføj `orchestratorTaskId?: string | null` til `Task`

### Fase 2 — Subtask spawning

**2.1 OrchestratorService (`src/main/services/OrchestratorService.ts`)** ← ny fil

- `watchForSubtaskPlan(taskId, worktreePath, projectId)`: Overvåger `.dash/subtasks.json`
- `spawnSubtasks(plan, orchestratorTask, project)`: Opretter worktrees + tasks for hvert subtask
- `updateStatusFile(orchestratorPath, subtasks)`: Skriver `.dash/subtask-status.json`
- `mergeSubtasks(orchestratorTask, subtasks)`: Kører `git merge` for alle subtask-branches

**2.2 IPC (`src/main/ipc/orchestratorIpc.ts`)** ← ny fil

- `orchestrator:startWatching` → OrchestratorService.watchForSubtaskPlan()
- `orchestrator:mergeSubtasks` → OrchestratorService.mergeSubtasks()
- `orchestrator:getSubtasks` → DatabaseService.getSubtasks()

**2.3 ptyManager integration**

- Når `startDirectPty` kaldes for en orchestrator-task: start fil-watcher automatisk

### Fase 3 — UI

**3.1 TaskModal (`src/renderer/components/TaskModal.tsx`)**

- Tilføj "Orchestrated task" toggle
- Når aktiveret: viser info-tekst om hvad orchestrator-mode gør
- `isOrchestrated: boolean` sendes med til `onCreate`

**3.2 LeftSidebar (`src/renderer/components/LeftSidebar.tsx`)**

- Subtasks vises indrykket under deres orchestrator
- Orchestrator-task viser progress-badge: `2/3 done`
- Særligt ikon (f.eks. `Network` fra lucide) på orchestrator-tasks

**3.3 OrchestratorPanel (`src/renderer/components/OrchestratorPanel.tsx`)** ← ny fil

- Vises i MainContent under task-headeren for orchestrator-tasks
- Viser subtask-liste med status-indikatorer
- "Merge subtasks" knap (aktiv når alle subtasks er idle)
- Merge-progress og eventuelle konflikt-advarsler

**3.4 App.tsx**

- Lyt på orchestrator-events (nye subtasks spawnet, status-opdateringer)
- Håndter `orchestrator:mergeSubtasks` flow

### Fase 4 — Prompt injection til master AI

**4.1 PromptFormatter (`src/main/services/ai/PromptFormatter.ts`)**

- `formatOrchestratorPrompt(prompt, meta)`: Prepender orchestrator-system-prompt

**4.2 Provider setup**

- Når `isOrchestrated=true`: brug `formatOrchestratorPrompt` i stedet for `formatGuardedPrompt`

---

## Merge-strategi

Subtask branches merges sekventielt ind i orchestratorens branch:

```
orchestrator-branch (base)
  ← merge subtask-1-branch
  ← merge subtask-2-branch
  ← merge subtask-3-branch
```

Ved konflikter:

1. Dash rapporterer konflikterne til brugeren
2. Brugeren kan vælge: manuelt løs i terminal, eller bed master AI om hjælp
3. Master AI kan inspicere konflikter via `git diff` og foreslå løsning

---

## Eksempel flow

```
1. Bruger opretter "Add authentication system" som orchestrated task
2. Claude (master) analyserer task og codebase
3. Claude skriver .dash/subtasks.json:
   - Subtask A: "JWT middleware" → claude
   - Subtask B: "Login UI components" → gemini
   - Subtask C: "Auth tests" → codex
4. Dash detekterer filen → opretter 3 worktrees + spawner 3 AI-sessioner
5. Sidebar viser: [orchestrator] med [A] [B] [C] indrykket under
6. Alle tre AI'er arbejder parallelt i egne terminaler
7. Efterhånden som de færdiggøres: status opdateres → "2/3 done"
8. Når alle er idle: "Merge subtasks" knap lyser op
9. Dash merger → orchestrator reviewer → bruger tester i UI → PR
```

---

## MVP scope (første iteration)

- [ ] DB: `orchestratorTaskId` kolonne + migration
- [ ] Types + DatabaseService: subtask-relationer
- [ ] OrchestratorService: fil-watcher + subtask spawning
- [ ] PromptFormatter: orchestrator system prompt
- [ ] TaskModal: "Orchestrated task" toggle
- [ ] LeftSidebar: subtasks nested + progress badge
- [ ] OrchestratorPanel: subtask-liste + merge-knap
- [ ] Merge flow: sekventiel git merge + konflikt-rapportering

## Fremtidigt (fase 2)

- Master AI reviewer automatisk merged diff
- Automatisk konflikt-løsning via master AI
- Subtask afhængigheder (B kan ikke starte før A er færdig)
- Re-delegation: master kan spawne yderligere subtasks undervejs
