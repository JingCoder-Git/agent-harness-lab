# s08: Background Tasks (后台任务)

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"慢操作丢后台, agent 继续想下一步"* -- 后台线程跑命令, 完成后注入通知。
>
> **Harness 层**: 后台执行 -- 模型继续思考, harness 负责等待。

## 问题

有些命令要跑好几分钟: `npm install`、`pytest`、`docker build`。阻塞式循环下模型只能干等。用户说 "装依赖, 顺便建个配置文件", Agent 却只能一个一个来。

## 解决方案

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

## 工作原理

1. BackgroundManager 用线程安全的通知队列追踪任务。

```ts
type BackgroundTask = { status: 'running' | 'completed'; command: string };
type Notification = { taskId: string; result: string };

class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>();
  private notificationQueue: Notification[] = [];
}
```

2. `run()` 启动守护线程, 立即返回。

```ts
run(command: string) {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: 'running', command });

  void this.execute(taskId, command);
  return `Background task ${taskId} started`;
}
```

3. 子进程完成后, 结果进入通知队列。

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

4. 每次 LLM 调用前排空通知队列。

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

循环保持单线程。只有子进程 I/O 被并行化。

## 相对 s07 的变更

| 组件           | 之前 (s07)       | 之后 (s08)                         |
|----------------|------------------|------------------------------------|
| Tools          | 8                | 6 (基础 + background_run + check)  |
| 执行方式       | 仅阻塞           | 阻塞 + 后台线程                    |
| 通知机制       | 无               | 每轮排空的队列                     |
| 并发           | 无               | 守护线程                           |

