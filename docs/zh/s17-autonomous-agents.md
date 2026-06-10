# s17: Autonomous Agents — 自己看板，自己认领

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s15 → s16 → `s17` → [s18](../s18_worktree_isolation/) → s19 → s20

> *"自己看板，自己认领"* — 空闲时轮询，有活就干。
>
> **Harness 层**: 自治 — 队友自组织，不依赖 Lead 分配。

---

## 问题

s16 的队友能通信、能握手关机。但每个队友等 Lead 分配任务——如果任务看板上有 10 个未认领任务，Lead 得手动 assign 10 次。这不能扩展。队友应该自己看任务看板，发现没人做的任务就认领，做完再找下一个。

---

## 解决方案

![Autonomous Agents Overview](/course-assets/s17_autonomous_agents/autonomous-agents-overview.svg)

沿用 S16 的教学版 MessageBus 和协议工具。本章新增：**idlePoll**（空闲时每 5 秒轮询一次）、**scanUnclaimedTasks**（扫描看板上可认领的任务）、**自动认领**（找到任务就 claim，不用 Lead 操心）。

队友生命周期从两阶段变成三阶段：

| 阶段 | 行为 | 退出条件 |
|------|------|---------|
| WORK | inbox → LLM → 工具循环 | `stop_reason != tool_use` |
| IDLE | 每 5s 轮询 inbox + 任务板 | 60s 超时 |
| SHUTDOWN | 发 summary，退出 | — |

---

## 工作原理

### idlePoll: 空闲轮询

队友完成当前任务后不退出，进入 IDLE 阶段——每 5 秒检查一次有没有新工作：

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

inbox 优先（可能包含 shutdown_request 等协议消息），任务板其次。IDLE 阶段收到 shutdown_request 会直接回复并退出，不等到下一轮 WORK。

### scanUnclaimedTasks: 扫描任务看板

找 pending 状态、无 owner、所有依赖已完成（`canStart`）的任务：

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

三个条件：必须是 pending、没有 owner、所有 blockedBy 依赖已完成。`canStart` 检查依赖任务的状态——有依赖不代表不能做，只有被未完成的任务阻塞才不能做。教学版按文件名排序取第一个；CC 用文件锁防止多个队友同时认领同一个任务。

### claimTask: owner 检查

自动认领时检查 claim 结果，不把失败当成功：

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

教学版没有文件锁，并发认领可能出现竞争。但至少 `task.owner` 检查避免了最明显的"后写覆盖"问题。CC 用 `proper-lockfile` 保护任务文件，`claimTask` 在文件锁内完成读-改-写（`utils/tasks.ts:541-612`）。

### 队友生命周期: WORK → IDLE → SHUTDOWN

s16 的队友做完任务就退出。s17 加了 IDLE 阶段，队友在外层循环中反复 WORK → IDLE：

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

关键设计：
- **外层 `while (true)`**：WORK 和 IDLE 交替进行，直到超时或收到关机请求
- **内层 for 10**：WORK 阶段最多 10 轮 LLM 调用（防止无限循环）
- **IDLE 超时 60 秒**：12 次轮询 × 5 秒 = 60 秒。超时后发送 summary 并退出
- **shutdown_request 两阶段都能响应**：WORK 阶段通过 `handleInboxMessage` 分发；IDLE 阶段 `idlePoll` 直接检查并回复

### 身份重注入

autoCompact（s08）之后，队友的 messages 列表可能被压缩成一段摘要。每次进入新的 WORK 阶段时检查：

```ts
if (messages.length <= 3) {
  messages.unshift({
    role: "user",
    content: `<identity>You are '${name}', role: ${role}. Continue your work.</identity>`,
  });
}
```

消息过短说明发生了压缩，此时重新注入身份信息。真实 CC 中 context compaction 会保留 system prompt，教学版的简化实现需要手动处理。

### consumeLeadInbox: 统一 inbox 消费

`checkInbox` 工具和主循环末尾都调用同一个 `consumeLeadInbox()` 函数：先路由协议 response 更新状态，再把所有消息注入 Lead 的对话历史。队友发来的 summary/result 不会只打印在终端，Lead 的 LLM 能看到并协调下一步。

### 合起来跑

```
1. Lead: "构建后端 - 任务太多，让队友自己认领"
2. Lead -> createTask("创建数据库 schema")
3. Lead -> createTask("写 API 路由")
4. Lead -> createTask("写单元测试")
5. Lead -> spawnTeammate("alice", "backend", "你是后端开发者")
6. Lead -> spawnTeammate("bob", "backend", "你是后端开发者")

7. alice 线程启动 -> WORK: 没有初始 inbox -> 运转 -> IDLE
8. bob 线程启动 -> WORK: 没有初始 inbox -> 运转 -> IDLE

9. alice IDLE poll 1 -> scanUnclaimedTasks -> 找到 "创建数据库 schema"
10. alice -> claimTask -> "创建数据库 schema" -> 回到 WORK
11. bob IDLE poll 1 -> scanUnclaimedTasks -> 找到 "写 API 路由"
12. bob -> claimTask -> "写 API 路由" -> 回到 WORK

13. alice WORK: writeFile("schema.sql", ...) -> completeTask -> WORK 结束
14. alice IDLE -> scan -> "写单元测试" -> claim -> WORK
15. alice WORK: writeFile("test_api.ts", ...) -> completeTask -> WORK 结束
16. alice IDLE -> 60s 没有新任务 -> SHUTDOWN

17. bob 类似流程 -> 完成 -> SHUTDOWN
18. Lead consumeLeadInbox -> 看到 alice 和 bob 的 summary
```

两个队友并行认领、并行工作。Lead 只需要创建任务和启动队友，不需要手动分配。

---

## 相对 s16 的变更

| 组件 | 之前 (s16) | 之后 (s17) |
|------|-----------|-----------|
| 任务分配 | Lead 手动 assign | 队友自动认领（canStart 检查依赖） |
| 队友状态 | WORK 或退出 | WORK → IDLE（轮询 60s） → SHUTDOWN |
| claimTask | 无 owner 检查 | 拒绝已有 owner 的任务 |
| IDLE 阶段关机 | 不处理 shutdown_request | 直接 dispatch shutdown 并退出 |
| Lead inbox | 只打印，不进上下文 | consumeLeadInbox 统一注入 history |
| 新函数 | — | idlePoll, scanUnclaimedTasks, consumeLeadInbox |
| 身份保持 | 仅 system prompt | 压缩后自动重注入 |
| Lead 工具 | 14 (s16) | 14（不变） |
| 队友工具 | 5 | 8（+ listTasks, claimTask, completeTask） |
| 队友退出条件 | 完成任务即退出 | 60s 无新任务才退出 |

---


## 接下来

队友自组织了。但 Alice 和 Bob 都在同一个目录下工作——Alice 改 `config.ts`，Bob 也改 `config.ts`，互相覆盖。

s18 Worktree Isolation → 每个任务有自己的工作目录，互不干扰。

<details>
<summary>深入 CC 源码</summary>

> 教学说明：本章的 idlePoll + auto-claim 机制是教学设计，用统一的轮询函数演示"空闲后找活干"。CC 的实际实现是多个机制的组合，但目标一致——减少 Lead 的手动分配负担。

### 一、CC 的空闲机制：组合路径，不是单一轮询

教学版用一个 `idlePoll()` 统一处理空闲时的 inbox 检查和任务认领。CC 的实际实现是四个机制的组合：

**idle_notification**：队友完成一轮工作后，`sendIdleNotification()`（`inProcessRunner.ts:569-589`）向 Lead 发送空闲通知。Lead 知道队友可用了，可以分配新任务或请求关机。

**mailbox 轮询**：`waitForNextPromptOrShutdown()`（`inProcessRunner.ts:689-868`）是一个 **500ms 轮询循环**，持续检查三类来源：pending user messages、mailbox 文件消息、task list。shutdown_request 被优先处理（`inProcessRunner.ts:768-804`），不会被普通消息饿死。

**task watcher**：`useTaskListWatcher`（`hooks/useTaskListWatcher.ts:34-189`）用 `fs.watch()` 监听 `.claude/tasks/` 目录变化，1 秒 debounce，当新任务创建或依赖解锁时触发检查。依赖判断（`L197-207`）是"blockedBy 中没有未完成的任务"，不是"blockedBy 为空"。

**主动 claim**：轮询循环内部也会调用 `tryClaimNextTask()`（`inProcessRunner.ts:853-860`）——在等待期间主动从 task list 领取任务。所以"队友不主动轮询任务"不准确，CC 同时有被动通知和主动认领。

### 二、任务认领：文件锁 + 原子操作

`claimTask()`（`utils/tasks.ts:541-612`）用 `proper-lockfile` 的任务文件锁，在锁内完成读-检查-改-写。检查项：owner 是否已存在（`L575-576`）、是否已完成（`L580-581`）、blockedBy 中是否有未完成任务（`L585-594`）。`claimTaskWithBusyCheck()`（`utils/tasks.ts:614-692`）用 task-list 级别锁，把 busy check 和 claim 做成原子操作，避免 TOCTOU。

`findAvailableTask()`（`inProcessRunner.ts:595-604`）的依赖判断也是"所有 blockedBy 已完成"，用 `task.blockedBy.every(id => !unresolvedTaskIds.has(id))` 实现。`tryClaimNextTask()`（`inProcessRunner.ts:624-657`）在认领后把状态更新为 `in_progress`，让 UI 立即反映变化。

### 三、教学版 vs CC 对比

| 维度 | 教学版 (s17) | CC |
|------|-------------|-----|
| 空闲机制 | idlePoll 统一轮询（5s） | idle_notification + 500ms mailbox 轮询 + task watcher |
| 任务发现 | scanUnclaimedTasks（轮询） | useTaskListWatcher（文件监听）+ tryClaimNextTask（主动轮询） |
| 依赖判断 | canStart（所有 blockedBy 已完成） | findAvailableTask（同样语义） |
| 并发安全 | owner 检查（无文件锁） | proper-lockfile 任务锁 + task-list 锁 |
| shutdown 处理 | IDLE 直接分发，WORK 通过 handleInboxMessage | 500ms 轮询中优先处理 shutdown_request |
| 超时退出 | 60s 无新任务 | 无固定超时，Lead 手动 shutdown |
| 身份保持 | messages 长度检测 | context compaction 保留 system prompt |
| claim 失败处理 | 检查返回值，失败不注入 | 文件锁保证原子性 |

教学版的 `idlePoll()` 把 CC 的四个机制合并成一个轮询函数——简化合理，因为核心语义（空闲时找活干、依赖解锁后可认领、shutdown 优先）是一致的。

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
