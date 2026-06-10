# s10: Team Protocols

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > [ s10 ] s11 > s12`

> *"Teammates need shared communication rules"* -- one request-response pattern drives all negotiation.
>
> **Harness layer**: Protocols -- structured handshakes between models.

## Problem

In s09, teammates work and communicate but lack structured coordination:

**Shutdown**: Killing a thread leaves files half-written and config.json stale. You need a handshake: the lead requests, the teammate approves (finish and exit) or rejects (keep working).

**Plan approval**: When the lead says "refactor the auth module," the teammate starts immediately. For high-risk changes, the lead should review the plan first.

Both share the same structure: one side sends a request with a unique ID, the other responds referencing that ID.

## Solution

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

## How It Works

1. The lead initiates shutdown by generating a requestId and sending through the inbox.

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

2. The teammate receives the request and responds with approve/reject.

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

3. Plan approval follows the identical pattern. The teammate submits a plan (generating a requestId), the lead reviews (referencing the same requestId).

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

One FSM, two applications. The same `pending -> approved | rejected` state machine handles any request-response protocol.

## What Changed From s09

| Component      | Before (s09)     | After (s10)                  |
|----------------|------------------|------------------------------|
| Tools          | 9                | 12 (+shutdown_req/resp +plan)|
| Shutdown       | Natural exit only| Request-response handshake   |
| Plan gating    | None             | Submit/review with approval  |
| Correlation    | None             | requestId per request       |
| FSM            | None             | pending -> approved/rejected |

