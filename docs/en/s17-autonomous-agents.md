# s17: Autonomous Agents — Check the Board, Claim the Task

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s15 → s16 → `s17` → [s18](../s18_worktree_isolation/) → s19 → s20

> *"Check the board, claim the task"* — poll when idle, work when found.
>
> **Harness Layer**: Autonomy — Self-organizing teammates, no leader assignment needed.

---

## The Problem

s16's teammates can communicate and handshake shutdown. But each teammate waits for Lead to assign tasks — with 10 unclaimed tasks on the board, Lead has to manually assign 10 times. This doesn't scale. Teammates should check the task board themselves, claim unowned tasks, and look for the next one when done.

---

## The Solution

![Autonomous Agents Overview](/course-assets/s17_autonomous_agents/autonomous-agents-overview.en.svg)

Carries forward S16's teaching-version MessageBus and protocol tools. This chapter adds: **idlePoll** (poll every 5 seconds when idle), **scanUnclaimedTasks** (scan the board for claimable tasks), **auto-claim** (claim on sight, no Lead needed).

Teammate lifecycle expands from two phases to three:

| Phase | Behavior | Exit condition |
|-------|----------|----------------|
| WORK | inbox → LLM → tool loop | `stop_reason != tool_use` |
| IDLE | 5s poll inbox + task board | 60s timeout |
| SHUTDOWN | Send summary, exit | — |

---

## How It Works

### idlePoll: Idle Polling

After completing a task, the teammate doesn't exit. It enters the IDLE phase — checking every 5 seconds for new work:

```ts
const IDLE_POLL_INTERVAL_MS = 5_000;
const IDLE_TIMEOUT_MS = 60_000;

async function idlePoll(agentName: string, messages: Message[], board: TaskBoard) {
  const deadline = Date.now() + IDLE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(IDLE_POLL_INTERVAL_MS);

    const inbox = bus.readInbox(agentName);
    const shutdown = inbox.find((message) => message.type === "shutdown_request");
    if (shutdown) {
      bus.send(agentName, "lead", "Shutting down.", "shutdown_response", {
        requestId: shutdown.metadata?.requestId,
        approve: true,
      });
      return "shutdown" as const;
    }

    if (inbox.length > 0) {
      messages.push({ role: "user", content: `<inbox>${JSON.stringify(inbox)}</inbox>` });
      return "work" as const;
    }

    const [task] = scanUnclaimedTasks(board);
    if (task) {
      const result = claimTask(task.id, agentName);
      if (result.startsWith("Claimed")) {
        messages.push({ role: "user", content: `<auto-claimed>${task.subject}</auto-claimed>` });
        return "work" as const;
      }
    }
  }

  return "timeout" as const;
}
```

Inbox takes priority (may contain protocol messages like shutdown_request), task board second. A shutdown_request received during IDLE is dispatched immediately — no need to wait for the next WORK phase.

### scanUnclaimedTasks: Scan the Task Board

Find tasks that are pending, unowned, with all dependencies completed (`canStart`):

```ts
function scanUnclaimedTasks(board: TaskBoard) {
  return board.tasks.filter(
    (task) =>
      task.status === "pending" &&
      !task.owner &&
      canStart(task.id, board)
  );
}
```

Three conditions: must be pending, no owner, all blockedBy dependencies completed. `canStart` checks dependency task status — having dependencies doesn't mean the task can't start, only unresolved dependencies block it. Teaching version picks the first by filename; CC uses file locks to prevent multiple teammates from claiming the same task.

### claimTask: Owner Check

Auto-claim checks the claim result, not treating failure as success:

```ts
function claimTask(taskId: string, owner = "agent") {
  const task = loadTask(taskId);
  if (task.status !== "pending") return `Task ${taskId} is ${task.status}, cannot claim`;
  if (task.owner) return `Task ${taskId} already owned by ${task.owner}`;
  if (!canStart(taskId)) return "Blocked by unresolved dependencies";

  task.owner = owner;
  task.status = "in_progress";
  saveTask(task);

  return `Claimed ${task.id} (${task.subject})`;
}
```

Teaching version has no file locks, so concurrent claims may still race. But the `task.owner` check avoids the most obvious "last writer wins" problem. CC uses `proper-lockfile` to protect task files, with `claimTask` doing read-modify-write inside a file lock (`utils/tasks.ts:541-612`).

### Teammate Lifecycle: WORK → IDLE → SHUTDOWN

s16's teammates exit after finishing. s17 adds the IDLE phase — teammates cycle through WORK → IDLE in an outer loop:

```ts
while (true) {
  for (let round = 0; round < 10; round += 1) {
    const response = await runWorkTurn(name, messages);
    if (response.stopReason !== "tool_use") break;
  }

  const idleResult = await idlePoll(name, messages, taskBoard);
  if (idleResult === "shutdown" || idleResult === "timeout") break;
}

bus.send(name, "lead", summarize(messages), "result");
```

Key design:
- **Outer `while (true)`**: WORK and IDLE alternate until timeout or shutdown request
- **Inner for 10**: WORK phase caps at 10 LLM rounds (prevents infinite loops)
- **IDLE timeout 60s**: 12 polls × 5s = 60s. Timeout sends summary and exits
- **shutdown_request works in both phases**: WORK phase dispatches via `handleInboxMessage`; IDLE phase's `idlePoll` checks and replies directly

### Identity Re-injection

After autoCompact (s08), a teammate's messages list may be compressed into a summary. On each new WORK phase entry, check:

```ts
if (messages.length <= 3) {
  messages.unshift({
    role: "user",
    content: `<identity>You are '${name}', role: ${role}. Continue your work.</identity>`,
  });
}
```

Short messages suggest compression happened — re-inject identity. In real CC, context compaction preserves the system prompt; the teaching version's simplified implementation needs manual handling.

### consumeLeadInbox: Unified Inbox Consumer

Both the `checkInbox` tool and the main loop call the same `consumeLeadInbox()` function: route protocol responses to update state first, then inject all messages into Lead's conversation history. Teammates' summaries and results don't just print to terminal — Lead's LLM can see them and coordinate next steps.

### Putting It Together

```
1. Lead: "Build the backend - too many tasks, let teammates self-claim"
2. Lead -> createTask("Create database schema")
3. Lead -> createTask("Write API routes")
4. Lead -> createTask("Write unit tests")
5. Lead -> spawnTeammate("alice", "backend", "You are a backend developer")
6. Lead -> spawnTeammate("bob", "backend", "You are a backend developer")

7. alice thread starts -> WORK: no initial inbox -> spins -> IDLE
8. bob thread starts -> WORK: no initial inbox -> spins -> IDLE

9. alice IDLE poll 1 -> scanUnclaimedTasks -> finds "Create database schema"
10. alice -> claimTask -> "Create database schema" -> back to WORK
11. bob IDLE poll 1 -> scanUnclaimedTasks -> finds "Write API routes"
12. bob -> claimTask -> "Write API routes" -> back to WORK

13. alice WORK: writeFile("schema.sql", ...) -> completeTask -> WORK ends
14. alice IDLE -> scan -> "Write unit tests" -> claim -> WORK
15. alice WORK: writeFile("test_api.ts", ...) -> completeTask -> WORK ends
16. alice IDLE -> 60s no new tasks -> SHUTDOWN

17. bob similar flow -> done -> SHUTDOWN
18. Lead consumeLeadInbox -> sees alice and bob's summaries
```

Two teammates claim and work in parallel. Lead only creates tasks and spawns teammates — no manual assignment needed.

---

## Changes from s16

| Component | Before (s16) | After (s17) |
|-----------|-------------|-------------|
| Task assignment | Lead manually assigns | Teammates auto-claim (canStart checks deps) |
| Teammate state | WORK or exit | WORK → IDLE (60s poll) → SHUTDOWN |
| claimTask | No owner check | Rejects tasks that already have an owner |
| IDLE phase shutdown | Doesn't handle shutdown_request | Dispatches shutdown immediately and exits |
| Lead inbox | Prints only, not in context | consumeLeadInbox injects into history |
| New functions | — | idlePoll, scanUnclaimedTasks, consumeLeadInbox |
| Identity persistence | System prompt only | Auto re-inject after compression |
| Lead tools | 14 (s16) | 14 (unchanged) |
| Teammate tools | 5 | 8 (+ listTasks, claimTask, completeTask) |
| Teammate exit | Exit after task done | Exit only after 60s idle timeout |

---


## What's Next

Teammates self-organize now. But Alice and Bob both work in the same directory — Alice edits `config.ts`, Bob also edits `config.ts`, overwriting each other.

s18 Worktree Isolation → Each task gets its own working directory, no conflicts.

<details>
<summary>Deep Dive into CC Source</summary>

> Teaching note: This chapter's idlePoll + auto-claim mechanism is a teaching design, using a unified polling function to demonstrate "find work when idle." CC's actual implementation combines multiple mechanisms, but shares the same goal — reducing Lead's manual assignment burden.

### 1. CC's Idle Mechanism: Combined Approach, Not Single Polling

Teaching version uses a single `idlePoll()` to handle both inbox checking and task claiming during idle. CC's actual implementation combines four mechanisms:

**idle_notification**: After completing a round of work, `sendIdleNotification()` (`inProcessRunner.ts:569-589`) sends an idle notification to Lead. Lead knows the teammate is available and can assign new tasks or request shutdown.

**mailbox polling**: `waitForNextPromptOrShutdown()` (`inProcessRunner.ts:689-868`) is a **500ms polling loop** that continuously checks three sources: pending user messages, mailbox file messages, and task list. Shutdown requests are prioritized (`inProcessRunner.ts:768-804`), preventing starvation by regular messages.

**task watcher**: `useTaskListWatcher` (`hooks/useTaskListWatcher.ts:34-189`) uses `fs.watch()` to monitor the `.claude/tasks/` directory with 1-second debounce, triggering checks when new tasks are created or dependencies unblock. The dependency check (`L197-207`) verifies "no incomplete tasks in blockedBy", not "blockedBy is empty".

**active claiming**: The polling loop also calls `tryClaimNextTask()` (`inProcessRunner.ts:853-860`) — actively claiming tasks from the task list while waiting. So "teammates don't actively poll for tasks" is inaccurate; CC has both passive notification and active claiming.

### 2. Task Claiming: File Locks + Atomic Operations

`claimTask()` (`utils/tasks.ts:541-612`) uses `proper-lockfile` task-level locks, performing read-check-modify-write within the lock. Checks: owner already exists (`L575-576`), already completed (`L580-581`), unresolved blockers in blockedBy (`L585-594`). `claimTaskWithBusyCheck()` (`utils/tasks.ts:614-692`) uses task-list level locks, making busy check and claim atomic to avoid TOCTOU.

`findAvailableTask()` (`inProcessRunner.ts:595-604`) checks "all blockedBy completed" using `task.blockedBy.every(id => !unresolvedTaskIds.has(id))`. `tryClaimNextTask()` (`inProcessRunner.ts:624-657`) updates status to `in_progress` after claiming, so the UI immediately reflects the change.

### 3. Teaching Version vs CC Comparison

| Dimension | Teaching (s17) | CC |
|-----------|----------------|-----|
| Idle mechanism | idlePoll unified polling (5s) | idle_notification + 500ms mailbox polling + task watcher |
| Task discovery | scanUnclaimedTasks (polling) | useTaskListWatcher (file watching) + tryClaimNextTask (active polling) |
| Dependency check | canStart (all blockedBy completed) | findAvailableTask (same semantics) |
| Concurrency safety | Owner check (no file lock) | proper-lockfile task lock + task-list lock |
| Shutdown handling | IDLE dispatches directly, WORK via handleInboxMessage | 500ms polling loop prioritizes shutdown_request |
| Timeout exit | 60s with no new tasks | No fixed timeout, Lead manual shutdown |
| Identity persistence | Messages length detection | Context compaction preserves system prompt |
| Claim failure handling | Check return value, skip on failure | File locks guarantee atomicity |

Teaching version's `idlePoll()` merges CC's four mechanisms into one polling function — a reasonable simplification since the core semantics (find work when idle, claim after deps resolve, prioritize shutdown) are consistent.

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
