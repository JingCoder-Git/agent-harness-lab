# s14: Cron Scheduler — 按时间表生产工作

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s12 → s13 → `s14` → [s15](../s15_agent_teams/) → s16 → ... → s20
> *"按时间表生产工作, 调度与执行解耦"* — cron 调度, 持久化或会话级。
>
> **Harness 层**: 调度 — 独立线程判断时间, 队列传递触发。

---

## 问题

闹钟不需要你盯着它才会响。你设好 7:00，到点它自己响，你在睡觉、在洗澡、在做饭，它都照响不误。

s13 让 Agent 能后台执行慢操作，但所有操作仍然是你手动触发的。你说一句，Agent 动一下。"每天早上 9 点跑测试"、"每 30 分钟检查 CI 状态"，这些周期性任务不该需要人每次来推。

---

## 解决方案

![Cron Scheduler Overview](/course-assets/s14_cron_scheduler/cron-scheduler-overview.svg)

教学代码沿用 S13 的简化任务系统、后台执行和 prompt 组装；为了聚焦调度器，省略完整错误恢复、记忆和技能系统。新增：独立的 cron 调度线程，每秒检查一次，时间到了把任务塞进 `cron_queue`；再由 queue processor 在 Agent 空闲时自动交付。

手动 vs 定时：

| | 手动触发 (s13) | 定时触发 (s14) |
|---|---|---|
| 触发者 | 用户输入 | 调度线程 |
| 触发时机 | 随时 | cron 表达式指定 |
| 需要人参与 | 是 | 否（调度器自动入队，空闲时自动交付） |
| 持久性 | — | durable 跨重启 |

---

## 工作原理

### 四层模型

Cron 调度分四层：

1. **Scheduler**：daemon 线程，每秒轮询，判断时间到了没有
2. **Queue**：`cron_queue`，调度线程写入已触发任务
3. **Queue Processor**：发现队列非空且 Agent 空闲，启动一轮 agent_loop
4. **Consumer**：agent_loop 从队列消费，注入到 messages

教学版实现的是最小 queue processor：用 `agent_lock` 判断 Agent 是否空闲，空闲时自动交付定时任务。真实 CC 的 `useQueueProcessor.ts` 还会处理 UI 阻塞、队列优先级和不同消息模式。

### CronJob: 数据结构

每个 cron 任务是一个 `CronJob` 对象：

```ts
type CronJob = {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  lastMinute?: string;
};
```

Cron 表达式，五段式，Unix 用了 50 年：

```
分钟  小时  日  月  星期
  *    *   *   *   *      每分钟
  0    9   *   *   *      每天早上 9:00
 */5    *   *   *   *      每 5 分钟
  0    9   *   *  1-5     工作日早上 9:00
```

支持 `*`、`*/N`、`N`、`N-M`、`N,M,...`。

### cronMatches: 五段式匹配

标准 cron 语义：分钟、小时、月必须全部匹配；日（DOM）和星期（DOW）同时被约束时任一匹配即可（OR）：

```ts
function fieldMatches(field: string, value: number) {
  if (field === '*') return true;
  if (field.includes(',')) return field.split(',').some((part) => fieldMatches(part, value));
  if (field.includes('/')) {
    const [range, stepText] = field.split('/');
    const step = Number(stepText);
    return range === '*' ? value % step === 0 : fieldMatches(range, value) && value % step === 0;
  }
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }
  return Number(field) === value;
}

function cronMatches(cron: string, date: Date) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');
  const dom = fieldMatches(dayOfMonth, date.getDate());
  const dow = fieldMatches(dayOfWeek, date.getDay());
  const day = dayOfMonth !== '*' && dayOfWeek !== '*' ? dom || dow : dom && dow;
  return fieldMatches(minute, date.getMinutes())
    && fieldMatches(hour, date.getHours())
    && fieldMatches(month, date.getMonth() + 1)
    && day;
}
```

### 独立调度线程: 每秒轮询

调度器跑在独立的 daemon 线程里，不依赖 agent_loop 是否在执行。单个 job 异常不会杀掉整个线程：

```ts
function startCronSchedulerLoop(jobs: CronJob[], queue: CronJob[]) {
  return setInterval(() => {
    const now = new Date();
    const minuteMarker = now.toISOString().slice(0, 16);

    for (const job of jobs) {
      if (job.lastMinute === minuteMarker) continue;
      if (!cronMatches(job.cron, now)) continue;
      job.lastMinute = minuteMarker;
      queue.push(job);
    }
  }, 1000);
}
```

关键设计：
- **独立于 agent_loop**：即使 agent_loop 没在跑，调度器也在后台检查时间
- **date-aware minute_marker**：用 `"YYYY-MM-DD HH:MM"` 防止同一分钟重复触发，同时不会在第二天跳过
- **单 job try/except**：一个坏 job 不会拖垮整个调度线程
- **一次性任务**：触发后自动从 scheduledJobs 里删除

### Queue Processor + agent_loop: 交付端

queue processor 不检查时间，只负责在队列有任务且 Agent 空闲时拉起一轮执行：

```ts
async function queueProcessorLoop(queue: CronJob[], agentIsIdle: () => boolean) {
  while (true) {
    if (agentIsIdle() && queue.length > 0) {
      const job = queue.shift()!;
      await agentLoop([{ role: 'user', content: `[Scheduled] ${job.prompt}` }]);
    }
    await sleep(1000);
  }
}
```

agent_loop 也不负责检查时间，它只从 `cron_queue` 里拿已触发的任务，注入到 messages 里：

```ts
function consumeCronQueue(queue: CronJob[]) {
  return queue.splice(0).map((job) => ({
    role: 'user' as const,
    content: `[Scheduled] ${job.prompt}`,
  }));
}

async function agentLoop(messages: Message[]) {
  messages.unshift(...consumeCronQueue(cronQueue));
  const response = await callModel(messages);
  await executeTools(response, messages);
}
```

生产者（调度线程）、交付者（queue processor）和消费者（agent_loop）通过 `cron_queue`、`cron_lock`、`agent_lock` 解耦。

### 校验：防止坏 cron 杀掉调度器

`schedule_job` 在注册前校验 cron 表达式，非法的直接返回错误：

```ts
function validateCron(cron: string) {
  const fields = cron.trim().split(/s+/);
  if (fields.length !== 5) return 'Cron must have five fields';
  return fields.every(Boolean) ? null : 'Cron fields cannot be empty';
}

function scheduleJob(cron: string, prompt: string, durable = true) {
  const error = validateCron(cron);
  if (error) return { ok: false, error };
  const job = { id: crypto.randomUUID(), cron, prompt, recurring: true, durable };
  scheduledJobs.push(job);
  return { ok: true, job };
}
```

从磁盘加载 durable job 时也会跳过非法表达式，避免单个坏任务拖垮启动。

### Durable vs Session-only

- **Durable**：任务定义写进 `.scheduled_tasks.json`。Agent 重启后加载文件，恢复任务。
- **Session-only**：只在内存里。Agent 关闭就没了。

> **重要前提**：cron 调度器必须在 Agent 进程内跑。进程关闭，调度也停。Durable 只意味着任务定义跨重启保留，下次 Agent 启动时调度器才会发现"该触发了"并触发。如果需要"即使应用关闭也能定时跑"，请用系统 crontab 或 systemd timer。

### 合起来跑

```
1. 启动时：
   loadDurableJobs() → 从 .scheduled_tasks.json 恢复持久化任务
   startCronSchedulerLoop() → 调度线程开始轮询
   startQueueProcessorLoop() → 队列处理器等待交付

2. 注册任务：
   scheduleCron({ cron: "*/2 * * * *", prompt: "run date", durable: true })
   → CronJob 写入 scheduledJobs + .scheduled_tasks.json

3. 每 2 分钟：
   调度线程检查 → cronMatches 返回 true → cronQueue.push(job)
   → queue processor 发现 Agent 空闲 → agentLoop consumes cronQueue
   → 注入 "[Scheduled] run date"
   → LLM 收到消息，执行 date 命令

4. 关闭进程：
   调度线程跟着停（daemon: true）
   .scheduled_tasks.json 还在磁盘上
   下次启动 → loadDurableJobs → 任务恢复
```

---

## 相对 s13 的变更

| 组件 | 之前 (s13) | 之后 (s14) |
|------|-----------|-----------|
| 触发方式 | 用户手动触发 | 调度线程自动入队 |
| 新类型 | — | CronJob dataclass (id, cron, prompt, recurring, durable) |
| 新函数 | — | cronMatches, validate_cron, schedule_job, cancel_job, cron_scheduler_loop, queue_processor_loop |
| 新存储 | — | .scheduled_tasks.json (durable) + 内存 (session-only) |
| 线程 | 后台执行线程 | + 调度线程 (daemon, 1s 轮询) + queue processor 线程 |
| 队列 | background_results | + cron_queue (调度线程写, queue processor 交付, agent_loop 消费) |
| 工具 | 8 (s12/s13) | + schedule_cron, list_crons, cancel_cron (11) |

---

## 接下来

一个 Agent 能做很多事了，能计划、能压缩、能后台、能定时。但有些任务太大了，不是一个 Agent 能搞定的。

"重构整个后端"，把认证模块、数据库层、API 路由、测试全部翻新。一个 Agent 的注意力是有限的，这需要一个团队。

s15 Agent Teams → 一个 Agent 不够，组队吧。持久队友 + 异步收件箱。

<details>
<summary>深入 CC 源码</summary>

> 以下基于 CC 源码 `CronCreateTool.ts`、`cronScheduler.ts`、`cron.ts`、`cronTasks.ts`、`cronTasksLock.ts`、`useScheduledTasks.ts`（139 行）的完整分析。

### 一、三个 Cron 工具

CC 暴露了三个 cron 工具给模型：`CronCreate`、`CronDelete`、`CronList`。全部由编译时门控 `feature('AGENT_TRIGGERS')` 和运行时 GrowthBook 标志 `tengu_kairos_cron` 控制。还有一个 `CLAUDE_CODE_DISABLE_CRON` 环境变量做本地覆盖。

### 二、存储：`.claude/scheduled_tasks.json`

```json
{ "tasks": [{ "id": "abc12345", "cron": "0 9 * * *", "prompt": "...", "recurring": true, "durable": true, "createdAt": 1714567890000 }] }
```

Durable 任务写磁盘；session-only 任务存于 `STATE.sessionCronTasks` 内存数组（进程重启丢失）。还有一个 `.scheduled_tasks.lock` 文件防止同项目的多个 session 重复触发。

### 三、调度器：1 秒轮询

`cronScheduler.ts` 每秒检查一次（`CHECK_INTERVAL_MS = 1000`）。谁持有锁谁触发文件任务；所有 session 都触发仅 session 任务。还有一个 `chokidar` 文件观察者监视 `scheduled_tasks.json` 变更。

### 四、Cron 表达式：标准 5 字段

分钟 小时 日 月 星期。支持 `*`、`*/N`、`N`、`N-M`、`N-M/S`、`N,M,...`。不支持 `L`、`W`、`?`。所有时间以本地时区解释。Day-of-month 和 day-of-week 同时约束时用 OR 语义。

### 五、抖动（防惊群效应）

- 重复性任务：触发延迟最多可达期间的 10%（上限 15 分钟），基于任务 ID 的确定性哈希
- 一次性任务：当触发时间落在 `:00` 或 `:30` 时，最多提前 90 秒触发
- 抖动配置可通过 GrowthBook 实时调整，60 秒刷新一次

### 六、自动过期

重复性任务 7 天后自动过期（可配置，上限 30 天）。过期前最后一次触发，触发后自动删除。

### 七、作业数上限

`MAX_JOBS = 50`（`CronCreateTool.ts:25`）。超限时返回错误："Too many scheduled jobs (max 50). Cancel one first."

### 八、触发注入

触发后通过 `enqueuePendingNotification()` 以 `priority: 'later'` 入队命令队列。标记 `workload: WORKLOAD_CRON`，API 在容量紧张时以更低的 QoS 为 cron 发起的请求服务。

### 九、Queue Processor：自动交付

真实 CC 通过 `useQueueProcessor.ts:48-60` 在无 query、无阻塞 UI、队列非空时自动触发处理。`queueProcessor.ts:52-87` 按队列优先级把命令交给 `handlePromptSubmit()`。教学版用 `queue_processor_loop` 保留核心行为：队列有任务且 Agent 空闲时，自动启动一轮 agent_loop。

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
