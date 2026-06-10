# s07: Task System

`s01 > s02 > s03 > s04 > s05 > s06 | [ s07 ] s08 > s09 > s10 > s11 > s12`

> *"Break big goals into small tasks, order them, persist to disk"* -- a file-based task graph with dependencies, laying the foundation for multi-agent collaboration.
>
> **Harness layer**: Persistent tasks -- goals that outlive any single conversation.

## Problem

s03's TodoManager is a flat checklist in memory: no ordering, no dependencies, no status beyond done-or-not. Real goals have structure -- task B depends on task A, tasks C and D can run in parallel, task E waits for both C and D.

Without explicit relationships, the agent can't tell what's ready, what's blocked, or what can run concurrently. And because the list lives only in memory, context compression (s06) wipes it clean.

## Solution

Promote the checklist into a **task graph** persisted to disk. Each task is a JSON file with status, dependencies (`blockedBy`). The graph answers three questions at any moment:

- **What's ready?** -- tasks with `pending` status and empty `blockedBy`.
- **What's blocked?** -- tasks waiting on unfinished dependencies.
- **What's done?** -- `completed` tasks, whose completion automatically unblocks dependents.

```
.tasks/
  task_1.json  {"id":1, "status":"completed"}
  task_2.json  {"id":2, "blockedBy":[1], "status":"pending"}
  task_3.json  {"id":3, "blockedBy":[1], "status":"pending"}
  task_4.json  {"id":4, "blockedBy":[2,3], "status":"pending"}

Task graph (DAG):
                 +----------+
            +--> | task 2   | --+
            |    | pending  |   |
+----------+     +----------+    +--> +----------+
| task 1   |                          | task 4   |
| completed| --> +----------+    +--> | blocked  |
+----------+     | task 3   | --+     +----------+
                 | pending  |
                 +----------+

Ordering:     task 1 must finish before 2 and 3
Parallelism:  tasks 2 and 3 can run at the same time
Dependencies: task 4 waits for both 2 and 3
Status:       pending -> in_progress -> completed
```

This task graph becomes the coordination backbone for everything after s07: background execution (s08), multi-agent teams (s09+), and worktree isolation (s12) all read from and write to this same structure.

## How It Works

1. **TaskManager**: one JSON file per task, CRUD with dependency graph.

```ts
type Task = {
  id: number;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  blockedBy: number[];
  owner: string;
};

class TaskManager {
  private nextId = 1;

  constructor(private tasksDir: string) {}

  async create(subject: string, description = '') {
    const task: Task = {
      id: this.nextId++,
      subject,
      status: 'pending',
      blockedBy: [],
      owner: '',
    };
    await this.save(task);
    return JSON.stringify({ ...task, description }, null, 2);
  }
}
```

2. **Dependency resolution**: completing a task clears its ID from every other task's `blockedBy` list, automatically unblocking dependents.

```ts
async function clearDependency(completedId: number) {
  for (const filePath of await listTaskFiles(tasksDir)) {
    const task = JSON.parse(await fs.readFile(filePath, 'utf8')) as Task;
    if (!task.blockedBy.includes(completedId)) continue;
    task.blockedBy = task.blockedBy.filter((id) => id !== completedId);
    await saveTask(task);
  }
}
```

3. **Status + dependency wiring**: `update` handles transitions and dependency edges.

```ts
async function updateTask(
  taskId: number,
  changes: { status?: Task['status']; addBlockedBy?: number[]; removeBlockedBy?: number[] }
) {
  const task = await loadTask(taskId);

  if (changes.status) {
    task.status = changes.status;
    if (changes.status === 'completed') await clearDependency(taskId);
  }
  if (changes.addBlockedBy) {
    task.blockedBy = [...new Set([...task.blockedBy, ...changes.addBlockedBy])];
  }
  if (changes.removeBlockedBy) {
    task.blockedBy = task.blockedBy.filter((id) => !changes.removeBlockedBy?.includes(id));
  }

  await saveTask(task);
}
```

4. Four task tools go into the dispatch map.

```ts
const toolHandlers: Record<string, ToolHandler> = {
  ...baseToolHandlers,
  task_create: (input) => tasks.create(String(input.subject)),
  task_update: (input) => tasks.update(Number(input.taskId), input.status as Task['status']),
  task_list: () => tasks.listAll(),
  task_get: (input) => tasks.get(Number(input.taskId)),
};
```

From s07 onward, the task graph is the default for multi-step work. s03's Todo remains for quick single-session checklists.

## What Changed From s06

| Component | Before (s06) | After (s07) |
|---|---|---|
| Tools | 5 | 8 (`task_create/update/list/get`) |
| Planning model | Flat checklist (in-memory) | Task graph with dependencies (on disk) |
| Relationships | None | `blockedBy` edges |
| Status tracking | Done or not | `pending` -> `in_progress` -> `completed` |
| Persistence | Lost on compression | Survives compression and restarts |

