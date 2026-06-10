# s08: Background Tasks

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"Run slow operations in the background; the agent keeps thinking"* -- daemon threads run commands, inject notifications on completion.
>
> **Harness layer**: Background execution -- the model thinks while the harness waits.

## Problem

Some commands take minutes: `npm install`, `pytest`, `docker build`. With a blocking loop, the model sits idle waiting. If the user asks "install dependencies and while that runs, create the config file," the agent does them sequentially, not in parallel.

## Solution

```
Main thread                Background thread
+-----------------+        +-----------------+
| agent loop      |        | subprocess runs |
| ...             |        | ...             |
| [LLM call] <---+------- | enqueue(result) |
|  ^drain queue   |        +-----------------+
+-----------------+

Timeline:
Agent --[spawn A]--[spawn B]--[other work]----
             |          |
             v          v
          [A runs]   [B runs]      (parallel)
             |          |
             +-- results injected before next LLM call --+
```

## How It Works

1. BackgroundManager tracks tasks with a thread-safe notification queue.

```ts
type BackgroundTask = { status: 'running' | 'completed'; command: string };
type Notification = { taskId: string; result: string };

class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>();
  private notificationQueue: Notification[] = [];
}
```

2. `run()` starts a daemon thread and returns immediately.

```ts
run(command: string) {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: 'running', command });

  void this.execute(taskId, command);
  return `Background task ${taskId} started`;
}
```

3. When the subprocess finishes, its result goes into the notification queue.

```ts
private async execute(taskId: string, command: string) {
  let output: string;
  try {
    output = await runShell(command, { cwd: workdir, timeoutMs: 300_000 });
    output = output.slice(0, 50_000);
  } catch (error) {
    output = error instanceof Error ? error.message : 'Unknown background error';
  }

  this.tasks.set(taskId, { status: 'completed', command });
  this.notificationQueue.push({ taskId, result: output.slice(0, 500) });
}
```

4. The agent loop drains notifications before each LLM call.

```ts
async function agentLoop(messages: Message[]) {
  while (true) {
    const notifications = background.drainNotifications();
    if (notifications.length > 0) {
      const text = notifications
        .map((item) => `[bg:${item.taskId}] ${item.result}`)
        .join('\n');
      messages.push({
        role: 'user',
        content: `<background-results>\n${text}\n</background-results>`,
      });
    }

    const response = await callModel(messages);
    await executeTools(response, messages);
  }
}
```

The loop stays single-threaded. Only subprocess I/O is parallelized.

## What Changed From s07

| Component      | Before (s07)     | After (s08)                |
|----------------|------------------|----------------------------|
| Tools          | 8                | 6 (base + background_run + check)|
| Execution      | Blocking only    | Blocking + background threads|
| Notification   | None             | Queue drained per loop     |
| Concurrency    | None             | Daemon threads             |

