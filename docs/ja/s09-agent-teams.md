# s09: Agent Teams

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > [ s09 ] s10 > s11 > s12`

> *"一人で終わらないなら、チームメイトに任せる"* -- 永続チームメイト + 非同期メールボックス。
>
> **Harness 層**: チームメールボックス -- 複数モデルをファイルで協調。

## 問題

サブエージェント(s04)は使い捨てだ: 生成し、作業し、要約を返し、消滅する。アイデンティティもなく、呼び出し間の記憶もない。バックグラウンドタスク(s08)はシェルコマンドを実行するが、LLM誘導の意思決定はできない。

本物のチームワークには: (1)単一プロンプトを超えて存続する永続エージェント、(2)アイデンティティとライフサイクル管理、(3)エージェント間の通信チャネルが必要だ。

## 解決策

```
Teammate lifecycle:
  spawn -> WORKING -> IDLE -> WORKING -> ... -> SHUTDOWN

Communication:
  .team/
    config.json           <- team roster + statuses
    inbox/
      alice.jsonl         <- append-only, drain-on-read
      bob.jsonl
      lead.jsonl

              +--------+    send("alice","bob","...")    +--------+
              | alice  | -----------------------------> |  bob   |
              | loop   |    bob.jsonl << {json_line}    |  loop  |
              +--------+                                +--------+
                   ^                                         |
                   |        BUS.readInbox("alice")          |
                   +---- alice.jsonl -> read + drain ---------+
```

## 仕組み

1. TeammateManagerがconfig.jsonでチーム名簿を管理する。

```ts
type Teammate = { name: string; role: string; status: 'working' | 'idle' };

class TeammateManager {
  private config: { members: Teammate[] } = { members: [] };
  private loops = new Map<string, Promise<void>>();

  constructor(private teamDir: string) {}
}
```

2. `spawn()`がチームメイトを作成し、そのエージェントループをスレッドで開始する。

```ts
spawn(name: string, role: string, prompt: string) {
  const member: Teammate = { name, role, status: 'working' };
  this.config.members.push(member);
  void this.saveConfig();

  const loop = this.teammateLoop(name, role, prompt);
  this.loops.set(name, loop);
  return `Spawned teammate '${name}' (role: ${role})`;
}
```

3. MessageBus: 追記専用のJSONLインボックス。`send()`がJSON行を追記し、`readInbox()`がすべて読み取ってドレインする。

```ts
type TeamMessage = {
  type: string;
  from: string;
  content: string;
  timestamp: number;
};

class MessageBus {
  constructor(private dir: string) {}

  async send(from: string, to: string, content: string, type = 'message', extra = {}) {
    const message = { type, from, content, timestamp: Date.now(), ...extra };
    await fs.appendFile(path.join(this.dir, `${to}.jsonl`), JSON.stringify(message) + '\n');
  }

  async readInbox(name: string) {
    const inboxPath = path.join(this.dir, `${name}.jsonl`);
    if (!existsSync(inboxPath)) return [] as TeamMessage[];
    const lines = (await fs.readFile(inboxPath, 'utf8')).trim().split('\n').filter(Boolean);
    await fs.writeFile(inboxPath, '');
    return lines.map((line) => JSON.parse(line) as TeamMessage);
  }
}
```

4. 各チームメイトは各LLM呼び出しの前にインボックスを確認し、受信メッセージをコンテキストに注入する。

```ts
private async teammateLoop(name: string, role: string, prompt: string) {
  const messages: Message[] = [{ role: 'user', content: prompt }];

  for (let round = 0; round < 50; round += 1) {
    const inbox = await bus.readInbox(name);
    if (inbox.length > 0) {
      messages.push({ role: 'user', content: `<inbox>${JSON.stringify(inbox)}</inbox>` });
    }

    const response = await callModel(messages);
    if (response.stop_reason !== 'tool_use') break;
    await executeTools(response, messages);
  }

  this.findMember(name).status = 'idle';
}
```

## s08からの変更点

| Component      | Before (s08)     | After (s09)                |
|----------------|------------------|----------------------------|
| Tools          | 6                | 9 (+spawn/send/readInbox) |
| Agents         | Single           | Lead + N teammates         |
| Persistence    | None             | config.json + JSONL inboxes|
| Threads        | Background cmds  | Full agent loops per thread|
| Lifecycle      | Fire-and-forget  | idle -> working -> idle    |
| Communication  | None             | message + broadcast        |

