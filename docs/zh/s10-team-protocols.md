# s10: Team Protocols (团队协议)

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > [ s10 ] s11 > s12`

> *"队友之间要有统一的沟通规矩"* -- 一个 request-response 模式驱动所有协商。
>
> **Harness 层**: 协议 -- 模型之间的结构化握手。

## 问题

s09 中队友能干活能通信, 但缺少结构化协调:

**关机**: 直接杀线程会留下写了一半的文件和过期的 config.json。需要握手 -- 领导请求, 队友批准 (收尾退出) 或拒绝 (继续干)。

**计划审批**: 领导说 "重构认证模块", 队友立刻开干。高风险变更应该先过审。

两者结构一样: 一方发带唯一 ID 的请求, 另一方引用同一 ID 响应。

## 解决方案

```
Shutdown Protocol            Plan Approval Protocol
==================           ======================

Lead             Teammate    Teammate           Lead
  |                 |           |                 |
  |--shutdown_req-->|           |--plan_req------>|
  | {requestId:"abc"}  |           | {requestId:"xyz"}  |
  |                 |           |                 |
  |<--shutdown_resp-|           |<--plan_resp-----|
  | {requestId:"abc",  |           | {requestId:"xyz",  |
  |  approve:true}  |           |  approve:true}  |

Shared FSM:
  [pending] --approve--> [approved]
  [pending] --reject---> [rejected]

Trackers:
  const shutdownRequests = new Map(requestId, { target, status })
  const planRequests     = new Map(requestId, { from, plan, status })
```

## 工作原理

1. 领导生成 requestId, 通过收件箱发起关机请求。

```ts
const shutdownRequests = new Map<string, { target: string; status: 'pending' | 'approved' | 'rejected' }>();

async function handleShutdownRequest(teammate: string) {
  const requestId = crypto.randomUUID().slice(0, 8);
  shutdownRequests.set(requestId, { target: teammate, status: 'pending' });
  await bus.send('lead', teammate, 'Please shut down gracefully.', 'shutdown_request', {
    requestId,
  });
  return `Shutdown request ${requestId} sent (status: pending)`;
}
```

2. 队友收到请求后, 用 approve/reject 响应。

```ts
if (toolName === 'shutdown_response') {
  const requestId = String(args.requestId);
  const approve = Boolean(args.approve);
  const request = shutdownRequests.get(requestId);
  if (request) request.status = approve ? 'approved' : 'rejected';

  await bus.send(sender, 'lead', String(args.reason ?? ''), 'shutdown_response', {
    requestId,
    approve,
  });
}
```

3. 计划审批遵循完全相同的模式。队友提交计划 (生成 requestId), 领导审查 (引用同一个 requestId)。

```ts
const planRequests = new Map<string, { from: string; status: 'pending' | 'approved' | 'rejected' }>();

async function handlePlanReview(requestId: string, approve: boolean, feedback = '') {
  const request = planRequests.get(requestId);
  if (!request) return 'Unknown plan request';

  request.status = approve ? 'approved' : 'rejected';
  await bus.send('lead', request.from, feedback, 'plan_approval_response', {
    requestId,
    approve,
  });
}
```

一个 FSM, 两种用途。同样的 `pending -> approved | rejected` 状态机可以套用到任何请求-响应协议上。

## 相对 s09 的变更

| 组件           | 之前 (s09)       | 之后 (s10)                           |
|----------------|------------------|--------------------------------------|
| Tools          | 9                | 12 (+shutdown_req/resp +plan)        |
| 关机           | 仅自然退出       | 请求-响应握手                        |
| 计划门控       | 无               | 提交/审查与审批                      |
| 关联           | 无               | 每个请求一个 requestId              |
| FSM            | 无               | pending -> approved/rejected         |

