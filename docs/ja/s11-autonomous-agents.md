# s11: Autonomous Agents

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > [ s11 ] s12`

> *"チームメイトが自らボードを見て、仕事を取る"* -- リーダーが逐一割り振る必要はない。
>
> **Harness 層**: 自律 -- 指示なしで仕事を見つけるモデル。

## 問題

s09-s10では、チームメイトは明示的に指示された時のみ作業する。リーダーは各チームメイトを特定のプロンプトでspawnしなければならない。タスクボードに未割り当てのタスクが10個あっても、リーダーが手動で各タスクを割り当てる。これはスケールしない。

真の自律性とは、チームメイトが自分で作業を見つけること: タスクボードをスキャンし、未確保のタスクを確保し、作業し、完了したら次を探す。

もう1つの問題: コンテキスト圧縮(s06)後にエージェントが自分の正体を忘れる可能性がある。アイデンティティ再注入がこれを解決する。

## 解決策

```
Teammate lifecycle with idle cycle:

+-------+
| spawn |
+---+---+
    |
    v
+-------+   tool_use     +-------+
| WORK  | <------------- |  LLM  |
+---+---+                +-------+
    |
    | stop_reason != tool_use (or idle tool called)
    v
+--------+
|  IDLE  |  poll every 5s for up to 60s
+---+----+
    |
    +---> check inbox --> message? ----------> WORK
    |
    +---> scan .tasks/ --> unclaimed? -------> claim -> WORK
    |
    +---> 60s timeout ----------------------> SHUTDOWN

Identity re-injection after compression:
  if len(messages) <= 3:
    messages.insert(0, identity_block)
```

## 仕組み

1. チームメイトのループはWORKとIDLEの2フェーズ。LLMがツール呼び出しを止めた時(または`idle`ツールを呼んだ時)、IDLEフェーズに入る。

```ts
private async loop(name: string, role: string, prompt: string) {
  while (true) {
    const messages: Message[] = [{ role: 'user', content: prompt }];

    for (let round = 0; round < 50; round += 1) {
      const response = await callModel(messages);
      if (response.stop_reason !== 'tool_use') break;
      await executeTools(response, messages);
      if (idleRequested(response)) break;
    }

    this.setStatus(name, 'idle');
    const resume = await this.idlePoll(name, messages);
    if (!resume) {
      this.setStatus(name, 'shutdown');
      return;
    }
  }
}
```

2. IDLEフェーズがインボックスとタスクボードをポーリングする。

```ts
private async idlePoll(name: string, messages: Message[]) {
  for (let tick = 0; tick < IDLE_TIMEOUT / POLL_INTERVAL; tick += 1) {
    await sleep(POLL_INTERVAL);

    const inbox = await bus.readInbox(name);
    if (inbox.length > 0) {
      messages.push({ role: 'user', content: `<inbox>${JSON.stringify(inbox)}</inbox>` });
      return true;
    }

    const [task] = await scanUnclaimedTasks();
    if (task) {
      await claimTask(task.id, name);
      messages.push({
        role: 'user',
        content: `<auto-claimed>Task #${task.id}: ${task.subject}</auto-claimed>`,
      });
      return true;
    }
  }

  return false;
}
```

3. タスクボードスキャン: pendingかつ未割り当てかつブロックされていないタスクを探す。

```ts
async function scanUnclaimedTasks() {
  const tasks = [] as Task[];
  for (const filePath of await listTaskFiles(tasksDir)) {
    const task = JSON.parse(await fs.readFile(filePath, 'utf8')) as Task;
    if (task.status === 'pending' && !task.owner && task.blockedBy.length === 0) {
      tasks.push(task);
    }
  }
  return tasks;
}
```

4. アイデンティティ再注入: コンテキストが短すぎる(圧縮が起きた)場合にアイデンティティブロックを挿入する。

```ts
if (messages.length <= 3) {
  messages.unshift({
    role: 'assistant',
    content: `I am ${name}. Continuing.`,
  });
  messages.unshift({
    role: 'user',
    content: `<identity>You are '${name}', role: ${role}, team: ${teamName}. Continue your work.</identity>`,
  });
}
```

## s10からの変更点

| Component      | Before (s10)     | After (s11)                |
|----------------|------------------|----------------------------|
| Tools          | 12               | 14 (+idle, +claim_task)    |
| Autonomy       | Lead-directed    | Self-organizing            |
| Idle phase     | None             | Poll inbox + task board    |
| Task claiming  | Manual only      | Auto-claim unclaimed tasks |
| Identity       | System prompt    | + re-injection after compress|
| Timeout        | None             | 60s idle -> auto shutdown  |
