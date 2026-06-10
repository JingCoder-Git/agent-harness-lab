# s13: Background Tasks — Slow Operations Go to the Background

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s11 → s12 → `s13` → [s14](../s14_cron_scheduler/) → s15 → ... → s20

> *"Slow operations go to the background, agent continues processing"* — Background threads run commands, inject notifications when done.
>
> **Harness Layer**: Background — Async execution, doesn't block the main loop.

---

## The Problem

Ever used a washing machine? Throw clothes in, press start, then go do other things — cook, reply to messages, read papers. 30 minutes later the machine beeps: done. You don't stand there waiting for 30 minutes.

The agent's bash tool is the same. `pip install torch` takes 10 minutes, `npm run build` takes 3 minutes. While these commands run, the agent waits for bash to return, unable to use that time to process other tasks.

Reading files is milliseconds, no wait. `git status` returns in under a second, no wait. But `npm install`? Minutes. The agent waits 10 minutes doing nothing, and LLM calls are billed by token — idle time is waste.

---

## The Solution

![Background Tasks Overview](/course-assets/s13_background_tasks/background-tasks-overview.en.svg)

Teaching code carries forward S12's simplified task system and prompt assembly; to stay focused on background tasks, it omits full error recovery, memory, and skill systems. The only change: slow operations go to background threads, the agent continues running the loop, and background results are injected as notifications.

Sync vs Background:

| | Sync (s12) | Background (s13) |
|---|---|---|
| Slow operations | Agent waits | Background thread executes |
| Agent idle | Yes | No, continues processing |
| Result | Immediate return | Notification injected next turn |
| Decision criteria | — | `run_in_background` param (model explicit request), heuristic fallback |

---

## How It Works

### should_run_background: Explicit Request First, Heuristic Fallback

The model explicitly requests background execution via the bash tool's `run_in_background` parameter. If the model doesn't specify, the teaching version falls back to keyword heuristics:

```ts
function shouldRunBackground(toolName: string, input: { runInBackground?: boolean; command?: string }) {
  if (toolName !== 'bash') return false;
  if (input.runInBackground === true) return true;

  const command = input.command ?? '';
  return /npm install|npm run build|pytest|cargo test/.test(command);
}
```

CC's bash tool schema has a `run_in_background: boolean` parameter (`BashTool.tsx:241`). The model decides which commands go to background, no keyword guessing. The teaching version keeps heuristics as fallback, but the primary path is explicit model request.

### start_background_task: Background Execution and Lifecycle

Wraps the tool call in a worker function, dispatches to a daemon thread. Each background task gets a unique ID, with state tracked in the `background_tasks` object:

```ts
type BackgroundTask = { id: string; command: string; status: 'running' | 'done'; result?: string };
const backgroundTasks = new Map<string, BackgroundTask>();
const backgroundResults: string[] = [];

function startBackgroundTask(command: string, run: () => Promise<string>) {
  const id = `bg_${String(backgroundTasks.size + 1).padStart(4, '0')}`;
  backgroundTasks.set(id, { id, command, status: 'running' });

  void run().then((result) => {
    backgroundTasks.set(id, { id, command, status: 'done', result });
    backgroundResults.push(`<task_notification id="${id}">${result}</task_notification>`);
  });

  return `[Background task ${id} started]`;
}
```

Returns `bg_id` instead of just `[Running in background...]`. `daemon: true` ensures threads exit when the agent process exits. The teaching version uses in-memory dicts for tracking; real CC has `LocalShellTaskState`, output redirected to files, with full lifecycle including stopping tasks and reading subsequent output.

### collect_background_results: Notification Collection

When background tasks complete, results are collected and formatted as `<task_notification>` messages:

```ts
function collectBackgroundResults() {
  const ready = [...backgroundResults];
  backgroundResults.length = 0;
  return ready.map((content) => ({
    role: 'user' as const,
    content,
  }));
}
```

Notifications don't reuse the original `tool_use_id`. The original tool call was already answered with a placeholder `tool_result`; background completion is an independent event, injected in `task_notification` format. This respects Messages API tool pairing: one `tool_use` gets exactly one `tool_result`.

### Loop Integration

In the agent loop, tool execution splits into two paths. Notifications and results merge into a single user message:

```ts
async function agentLoop(messages: Message[]) {
  while (true) {
    messages.push(...collectBackgroundResults());

    const response = await callModel(messages);
    const toolResults = await executeToolCalls(response, (toolCall) => {
      if (shouldRunBackground(toolCall.name, toolCall.input)) {
        return startBackgroundTask(toolCall.input.command, () => runBash(toolCall.input.command));
      }
      return runTool(toolCall);
    });

    messages.push({ role: 'user', content: toolResults });
  }
}
```

Slow operations get a placeholder tool_result with `bg_id`, so the LLM knows this command is still running and can do other things first. When background completes, the notification is injected as an independent text block alongside the current turn's tool_results in one user message.

The teaching version polls background results while the agent loop continues running. Real CC uses a notification queue (`messageQueueManager.ts`) to deliver background completion events to subsequent turns, without waiting for the tool loop.

### Putting It Together

```
Turn 1:
  LLM → bash "npm install" (run_in_background=true)
  → start_background_task → bg_0001
  → tool_result: "[Background task bg_0001 started]..."
  → LLM: "OK, I'll check later. Let me also read the config."

Turn 2:
  LLM → read_file "package.json" (fast, sync)
  → tool_result: file content
  → collect: bg_0001 done! inject <task_notification>
  → LLM sees: config file + install notification in one message
```

The agent didn't wait — while npm install ran in the background, it read the config file.

---

## Changes from s12

| Component | Before (s12) | After (s13) |
|-----------|-------------|-------------|
| Execution model | All synchronous | Slow ops to background thread + notification injection |
| bash schema | `command` | `command` + `run_in_background` |
| New functions | — | `should_run_background`, `is_slow_operation`, `start_background_task`, `collect_background_results` |
| New types | — | `background_tasks: object`, `background_results: object`, `background_lock: Lock` |
| Notification format | — | `<task_notification>` (doesn't reuse tool_use_id) |
| Loop behavior | Tools execute serially | Slow ops async, fast ops sync, notifications collected each turn |
| Tools | 8 (s12) | 8 (unchanged, execution strategy changed) |


## What's Next

Background tasks solved "slow operations don't block." But what if you want to do something on a schedule? Like "run tests every morning at 9am" or "check server status every 5 minutes."

s14 Cron Scheduler → Give the agent an alarm clock.

<details>
<summary>Deep Dive into CC Source</summary>

> The following is a complete analysis based on CC source code `query.ts` (lines 211, 1054-1060, 1411-1482), `services/toolUseSummary/toolUseSummaryGenerator.ts` (L15 prompt text), `LocalShellTask.tsx` (L24-25 constants, L59-98 watchdog logic), `messageQueueManager.ts` (notification queue), `utils/task/framework.ts` (L267 `enqueueTaskNotification`).

### 1. pendingToolUseSummary: Haiku Background Generation

CC starts a Haiku side-query after each batch of tool executions to generate a tool use summary. Initiated at `query.ts:1411-1482`, prompt text defined at `services/toolUseSummary/toolUseSummaryGenerator.ts:15` (variable `TOOL_USE_SUMMARY_SYSTEM_PROMPT`). The prompt is "Write a short summary label... think git-commit-subject, not sentence", past tense, ~30 characters.

Haiku summary (~1s) completes during the main model's streaming output (5-30s). Before the next turn starts, the summary is yielded. SDK consumers use these summaries for mobile progress display.

### 2. Thread Model: No Real Threads

CC runs on Node.js/Bun's single-threaded event loop. "Background" just means "don't await". `ShellCommand.background(taskId)` redirects stdout/stderr to files, letting the process run independently.

### 3. Seven Background Task Types

CC defines 7 background task types (`Task.ts:7-13`): `local_bash`, `local_agent`, `remote_agent`, `in_process_teammate`, `local_workflow`, `monitor_mcp`, `dream`. Each has its own registration, lifecycle, and notification mechanism.

### 4. Notification Injection: Command Queue

When a background task completes, it's enqueued via `enqueueTaskNotification` (`utils/task/framework.ts:267`) or `enqueuePendingNotification` (`messageQueueManager.ts`) into a shared command queue. The notification format is structured XML:

```xml
<task_notification>
  <status>completed</status>
  <summary>Background command "npm test" completed (exit code 0)</summary>
</task_notification>
```

Priority is `next` > `later` (`messageQueueManager.ts`). Background tasks default to `later` (don't block user input). Consumption point at `query.ts:1566-1593`.

### 5. Stall Watchdog

Background bash tasks have a watchdog (`LocalShellTask.tsx` L24-25 constants, L59-98 logic) that periodically checks if output has stalled. After 45 seconds with no growth, it detects interactive prompts (`(y/n)` etc.), preventing background tasks from getting stuck on unanswered interactive dialogs.

### 6. Concurrency Limits

Foreground tool calls: `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10 concurrent safe tools). Background bash tasks: no hard limit, they're independent subprocesses.

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
