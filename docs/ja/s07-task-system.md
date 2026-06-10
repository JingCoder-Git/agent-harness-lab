# s07: Task System

`s01 > s02 > s03 > s04 > s05 > s06 | [ s07 ] s08 > s09 > s10 > s11 > s12`

> *"大きな目標を小タスクに分解し、順序付けし、ディスクに記録する"* -- ファイルベースのタスクグラフ、マルチエージェント協調の基盤。
>
> **Harness 層**: 永続タスク -- どの会話よりも長く生きる目標。

## 問題

s03のTodoManagerはメモリ上のフラットなチェックリストに過ぎない: 順序なし、依存関係なし、ステータスは完了か未完了のみ。実際の目標には構造がある -- タスクBはタスクAに依存し、タスクCとDは並行実行でき、タスクEはCとDの両方を待つ。

明示的な関係がなければ、エージェントは何が実行可能で、何がブロックされ、何が同時に走れるかを判断できない。しかもリストはメモリ上にしかないため、コンテキスト圧縮(s06)で消える。

## 解決策

フラットなチェックリストをディスクに永続化する**タスクグラフ**に昇格させる。各タスクは1つのJSONファイルで、ステータス・前方依存(`blockedBy`)を持つ。タスクグラフは常に3つの問いに答える:

- **何が実行可能か?** -- `pending`ステータスで`blockedBy`が空のタスク。
- **何がブロックされているか?** -- 未完了の依存を待つタスク。
- **何が完了したか?** -- `completed`のタスク。完了時に後続タスクを自動的にアンブロックする。

```
.tasks/
  task_1.json  {"id":1, "status":"completed"}
  task_2.json  {"id":2, "blockedBy":[1], "status":"pending"}
  task_3.json  {"id":3, "blockedBy":[1], "status":"pending"}
  task_4.json  {"id":4, "blockedBy":[2,3], "status":"pending"}

タスクグラフ (DAG):
                 +----------+
            +--> | task 2   | --+
            |    | pending  |   |
+----------+     +----------+    +--> +----------+
| task 1   |                          | task 4   |
| completed| --> +----------+    +--> | blocked  |
+----------+     | task 3   | --+     +----------+
                 | pending  |
                 +----------+

順序:       task 1 は 2 と 3 より先に完了する必要がある
並行:       task 2 と 3 は同時に実行できる
依存:       task 4 は 2 と 3 の両方を待つ
ステータス: pending -> in_progress -> completed
```

このタスクグラフは s07 以降の全メカニズムの協調バックボーンとなる: バックグラウンド実行(s08)、マルチエージェントチーム(s09+)、worktree分離(s12)はすべてこの同じ構造を読み書きする。

## 仕組み

1. **TaskManager**: タスクごとに1つのJSONファイル、依存グラフ付きCRUD。

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

2. **依存解除**: タスク完了時に、他タスクの`blockedBy`リストから完了IDを除去し、後続タスクをアンブロックする。

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

3. **ステータス遷移 + 依存配線**: `update`がステータス変更と依存エッジを担う。

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

4. 4つのタスクツールをディスパッチマップに追加する。

```ts
const toolHandlers: Record<string, ToolHandler> = {
  ...baseToolHandlers,
  task_create: (input) => tasks.create(String(input.subject)),
  task_update: (input) => tasks.update(Number(input.taskId), input.status as Task['status']),
  task_list: () => tasks.listAll(),
  task_get: (input) => tasks.get(Number(input.taskId)),
};
```

s07以降、タスクグラフがマルチステップ作業のデフォルト。s03のTodoは軽量な単一セッション用チェックリストとして残る。

## s06からの変更点

| コンポーネント | Before (s06) | After (s07) |
|---|---|---|
| Tools | 5 | 8 (`task_create/update/list/get`) |
| 計画モデル | フラットチェックリスト (メモリ) | 依存関係付きタスクグラフ (ディスク) |
| 関係 | なし | `blockedBy` エッジ |
| ステータス追跡 | 完了か未完了 | `pending` -> `in_progress` -> `completed` |
| 永続性 | 圧縮で消失 | 圧縮・再起動後も存続 |

