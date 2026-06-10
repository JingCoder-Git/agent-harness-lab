# s18: Worktree Isolation — Separate Directories, No Conflicts

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s16 → s17 → `s18` → [s19](../s19_mcp_plugin/) → s20

> *"Separate directories, no conflicts"* — Tasks own the goal, worktrees own the directory, bound by ID.
>
> **Harness Layer**: Isolation — Parallel execution in separate directories.

---

## The Problem

In s17, Alice and Bob both work in the same directory. Alice's task is "refactor auth module", Bob's task is "refactor UI login page".

Alice calls `writeFile("config.ts", ...)`. Bob also calls `writeFile("config.ts", ...)`. Both edit the same file, overwriting each other. And there's no clean rollback — you can't tell whose changes are whose.

s15-s17 solved "who does what" (task system) and "how to communicate" (message bus), but not "where to work".

---

## The Solution

![Worktree Overview](/course-assets/s18_worktree_isolation/worktree-overview.en.svg)

Git worktree lets you create multiple independent working directories in the same repo, each with its own branch. Alice works in `.worktrees/auth-refactor/`, Bob in `.worktrees/ui-login/` — no conflicts.

Carries forward S17's teaching-version MessageBus, protocols, and autonomous claiming. This chapter adds:

| Capability | Purpose |
|------------|---------|
| createWorktree | Create isolated directory + branch for a task |
| bindTaskToWorktree | Bind task and directory (no status change) |
| removeWorktree / keepWorktree | Cleanup or preserve after completion |
| validateWorktreeName | Reject path traversal and illegal characters |

---

## How It Works

### Creation: Task-Worktree Binding

```ts
function createWorktree(name: string, taskId = "") {
  const error = validateWorktreeName(name);
  if (error) return `Error: ${error}`;

  const worktreePath = path.join(worktreesDir, name);
  const result = runGit(["worktree", "add", worktreePath, "-b", `wt/${name}`, "HEAD"]);
  if (!result.ok) return `Git error: ${result.output}`;

  if (taskId) bindTaskToWorktree(taskId, name);
  logEvent("create", name, taskId);

  return `Worktree '${name}' created at ${worktreePath}`;
}

function bindTaskToWorktree(taskId: string, worktreeName: string) {
  const task = loadTask(taskId);
  task.worktree = worktreeName;
  saveTask(task);
}
```

Binding rule: one task binds to one worktree. Binding does NOT change task status — the task stays `pending`, and advances to `in_progress` only when a teammate claims it. This way Lead can pre-create tasks and worktrees, and teammates naturally claim worktree-bound tasks during idle.

### Teammate Tool Cwd Switching

Teaching version maintains a `worktreeContext` dict per teammate, tracking the current worktree path. When a teammate claims a task with a worktree, `worktreeContext` is automatically set to the worktree path; the teammate's `bash`, `readFile`, `writeFile` execute in the worktree directory:

```ts
const worktreeContext: { path?: string } = {};

function runClaimTask(taskId: string) {
  const result = claimTask(taskId, name);
  if (result.startsWith("Claimed")) {
    const task = loadTask(taskId);
    if (task.worktree) worktreeContext.path = path.join(worktreesDir, task.worktree);
  }
  return result;
}

function runBashInContext(command: string) {
  return runBash(command, { cwd: worktreeContext.path });
}
```

This is a teaching simplification. Real CC's EnterWorktree uses `process.chdir()` to switch the entire process directory, and AgentTool isolation uses `cwdOverride` to wrap sub-agent execution.

### Cleanup: Keep or Remove

After task completion, two choices:

```ts
function removeWorktree(name: string, discardChanges = false) {
  if (!discardChanges) {
    const { files, commits } = countWorktreeChanges(name);
    if (files > 0 || commits > 0) {
      return "Has uncommitted changes. Use discardChanges=true to force, or keepWorktree";
    }
  }

  const result = runGit(["worktree", "remove", worktreePath(name), "--force"]);
  if (!result.ok) return "Remove failed";

  runGit(["branch", "-D", `wt/${name}`]);
  logEvent("remove", name);
}

function keepWorktree(name: string) {
  logEvent("keep", name);
  return `Worktree '${name}' kept for review (branch: wt/${name})`;
}
```

Keep = preserve branch for manual review and merge. Remove = refuse by default if uncommitted changes; requires `discardChanges=true` to confirm. Does NOT auto-complete task — task completion is triggered explicitly by the teammate's `completeTask`.

### Event Log: Auditable

Each lifecycle operation writes to a log for auditing:

```ts
function logEvent(type: "create" | "remove" | "keep", worktree: string, taskId = "") {
  const event = { type, worktree, taskId, timestamp: Date.now() };
  appendJsonLine(path.join(worktreesDir, "events.jsonl"), event);
}
```

Event types: `create`, `remove`, `keep`. Teaching version logs events for manual auditing; full recovery would need an index or `git worktree list` scanning.

### runGit: Returns Success/Failure

```ts
function runGit(args: string[]) {
  const result = spawnSync("git", args, { cwd: workdir, encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
}
```

`createWorktree` and `removeWorktree` only write event logs after successful git commands, ensuring logs reflect actual state.

---

## Changes from s17

| Component | Before (s17) | After (s18) |
|-----------|-------------|-------------|
| Working directory | All agents share WORKDIR | Each task can bind to a git worktree |
| Task data | id/subject/status/owner/blockedBy | + worktree field |
| Teammate tool cwd | Always WORKDIR | Auto-switches when claiming worktree-bound task |
| New functions | — | createWorktree, bindTaskToWorktree, removeWorktree, keepWorktree, validateWorktreeName |
| Worktree safety | None | Name validation + refuse removal with changes |
| Event log | None | events.jsonl lifecycle auditing |
| Lead tools | 14 (s17) | + createWorktree, removeWorktree, keepWorktree (17) |
| Teammate tools | 8 (s17) | 8 (bash/read/write execute in worktree cwd) |

---


## What's Next

Agent teams can now self-organize in isolated workspaces. But Agent capabilities are limited to the tools we wrote — bash, read, write, task...

What if users already have their own tools? Like an internal Jira API, or a custom deployment system?

s19 MCP Plugin → Give Agent a plugin system. External tools connect via standard protocol; Agent doesn't need to know who wrote them.

<details>
<summary>Deep Dive into CC Source</summary>

CC's worktree system has two paths: **EnterWorktree** (current session switches in) and **AgentTool isolation** (sub-agent isolation).

### EnterWorktree: Current Session Switch

`EnterWorktreeTool.ts:92-97` after creating the worktree, immediately calls `process.chdir(worktreePath)`, `setCwd()`, `setOriginalCwd()`, `saveWorktreeState()`. The current session's working directory switches directly to the worktree — not a prompt hint, but a process-level directory change.

`ExitWorktreeTool.ts:261-320` both keep and remove call `restoreSessionToOriginalCwd()` to restore the original directory. Remove checks for uncommitted changes (`ExitWorktreeTool.ts:190-220`), refusing without `discardChanges: true`.

### AgentTool Isolation: Sub-Agent Isolation

`AgentTool.tsx:590-641` when `isolation: "worktree"`, calls `createAgentWorktree()` to create a worktree, uses `cwdOverridePath` to wrap sub-agent execution. All sub-agent operations automatically run in the worktree directory. `AgentTool/prompt.ts:272` tells the model: this is a temporary worktree, auto-cleanup if no changes, return path and branch if changes exist.

`worktree.ts:902-951` `createAgentWorktree()` does NOT modify global session cwd, only for sub-agent use. `worktree.ts:961-1020` `removeAgentWorktree()` deletes from the main repo root.

### Name Validation

`worktree.ts:76-84` validates slug: rejects `.`/`..`, allows `[a-zA-Z0-9._-]`. `worktree.ts:48` defines `VALID_WORKTREE_SLUG_SEGMENT`. Teaching version's `validateWorktreeName` uses the same rule.

### Path and Branch Naming

Real path is `.claude/worktrees/`, branch name `worktree-{slug}` (`worktree.ts:204-227`, slashes replaced with `+`). Teaching version uses `.worktrees/` and `wt/{name}` for simplicity.

Creation uses `git worktree add -B` (`worktree.ts:326-328`), preferring `origin/<defaultBranch>` over current HEAD.

### State Management

CC has no task-worktree binding. Worktree state is managed through `PersistedWorktreeSession` (`worktree.ts:756-768`), with fields including `originalCwd`, `worktreePath`, `worktreeName`, `worktreeBranch`, `originalBranch`, `originalHeadCommit`, `sessionId`, etc. — no taskId field. `saveWorktreeState()` (`sessionStorage.ts:2883-2920`) writes to session transcript with `type: 'worktree-state'`.

Teaching version uses the task's `worktree` field for binding, a teaching simplification. CC treats worktree and task as two independent systems, connected through the Agent's context understanding.

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v0 -->
