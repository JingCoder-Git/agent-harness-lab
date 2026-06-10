# s09: Agent Teams (Agent 团队)

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > [ s09 ] s10 > s11 > s12`

> *"任务太大一个人干不完, 要能分给队友"* -- 持久化队友 + JSONL 邮箱。
>
> **Harness 层**: 团队邮箱 -- 多个模型, 通过文件协调。

## 问题

Subagent (s04) 是一次性的: 生成、干活、返回摘要、消亡。没有身份, 没有跨调用的记忆。Background Tasks (s08) 能跑 shell 命令, 但做不了 LLM 引导的决策。

真正的团队协作需要三样东西: (1) 能跨多轮对话存活的持久 Agent, (2) 身份和生命周期管理, (3) Agent 之间的通信通道。

## 解决方案

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

## 工作原理

1. TeammateManager 通过 config.json 维护团队名册。

```ts
type Teammate = { name: string; role: string; status: 'working' | 'idle' };

class TeammateManager {
  private config: { members: Teammate[] } = { members: [] };
  private loops = new Map<string, Promise<void>>();

  constructor(private teamDir: string) {}
}
```

2. `spawn()` 创建队友并在线程中启动 agent loop。

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

3. MessageBus: append-only 的 JSONL 收件箱。`send()` 追加一行; `readInbox()` 读取全部并清空。

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

4. 每个队友在每次 LLM 调用前检查收件箱, 将消息注入上下文。

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

## 相对 s08 的变更

| 组件           | 之前 (s08)       | 之后 (s09)                         |
|----------------|------------------|------------------------------------|
| Tools          | 6                | 9 (+spawn/send/readInbox)         |
| Agent 数量     | 单一             | 领导 + N 个队友                    |
| 持久化         | 无               | config.json + JSONL 收件箱         |
| 线程           | 后台命令         | 每线程完整 agent loop              |
| 生命周期       | 一次性           | idle -> working -> idle            |
| 通信           | 无               | message + broadcast                |

