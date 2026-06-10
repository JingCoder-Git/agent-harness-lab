# s08: Background Tasks

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"遅い操作はバックグラウンドへ、エージェントは次を考え続ける"* -- デーモンスレッドがコマンド実行、完了後に通知を注入。
>
> **Harness 層**: バックグラウンド実行 -- モデルが考え続ける間、Harness が待つ。

## 問題

一部のコマンドは数分かかる: `npm install`、`pytest`、`docker build`。ブロッキングループでは、モデルはサブプロセスの完了を待って座っている。ユーザーが「依存関係をインストールして、その間にconfigファイルを作って」と言っても、エージェントは並列ではなく逐次的に処理する。

## 解決策

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

## 仕組み

1. BackgroundManagerがスレッドセーフな通知キューでタスクを追跡する。

```ts
type BackgroundTask = { status: 'running' | 'completed'; command: string };
type Notification = { taskId: string; result: string };

class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>();
  private notificationQueue: Notification[] = [];
}
```

2. `run()`がデーモンスレッドを開始し、即座にリターンする。

```ts
run(command: string) {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: 'running', command });

  void this.execute(taskId, command);
  return `Background task ${taskId} started`;
}
```

3. サブプロセス完了時に、結果を通知キューへ。

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

4. エージェントループが各LLM呼び出しの前に通知をドレインする。

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

ループはシングルスレッドのまま。サブプロセスI/Oだけが並列化される。

## s07からの変更点

| Component      | Before (s07)     | After (s08)                |
|----------------|------------------|----------------------------|
| Tools          | 8                | 6 (base + background_run + check)|
| Execution      | Blocking only    | Blocking + background threads|
| Notification   | None             | Queue drained per loop     |
| Concurrency    | None             | Daemon threads             |
