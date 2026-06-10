# s16: Team Protocols — Teammates Need Agreements

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s14 → s15 → `s16` → [s17](../s17_autonomous_agents/) → s18 → s19 → s20
> *"Teammates need agreements"* — request-response pattern drives all negotiation.
>
> **Harness Layer**: Protocols — Structured handshakes between agents.

---

## The Problem

s15's teammates can work, but coordination is loose: Lead sends a message, teammate replies, no structured protocol. Two scenarios expose the gap:

**Shutdown**: Lead wants Alice to shut down. Killing the thread outright leaves half-written files on disk. A handshake is needed: Lead sends a request, Alice confirms after wrapping up.

**Plan approval**: Bob wants to refactor the auth module, a high-risk operation. Lead should review Bob's plan first, approve before Bob proceeds.

Both scenarios share the same structure: one side sends a request, the other replies, both linked by the same ID. A state machine tracks: pending → approved / rejected.

---

## The Solution

![Team Protocols Overview](/course-assets/s16_team_protocols/team-protocols-overview.en.svg)

Teaching code continues the agent capability arc from earlier chapters and adds structured protocols on top of S15's team communication. To stay focused on the protocol mechanism, it omits full error recovery, memory, and skill systems. Added: **ProtocolState** (request state tracking), **dispatchMessage** (routes incoming messages by type to handlers), **matchResponse** (correlates response to request via requestId, with type validation).

Two protocols, one mechanism:

| Protocol | Direction | Purpose |
|----------|-----------|---------|
| shutdown_request / response | Lead → Teammate | Graceful shutdown handshake |
| plan_approval_request / response | Teammate → Lead | Plan approval protocol example |

> Teaching version demonstrates the request-response message flow for plan approval, but does not implement execution gating (intercepting bash/write_file when not approved). Real CC has a permission gating mechanism for teammates.

---

## How It Works

### ProtocolState: Request State

Each protocol request creates a state record tracking who sent it, to whom, current status, and payload:

```ts
type ProtocolState = {
  requestId: string;      // Unique ID, e.g. 'req_004281'
  type: 'shutdown' | 'plan_approval';
  sender: string;
  target: string;
  status: 'pending' | 'approved' | 'rejected';
  payload: string;
  createdAt: number;
};

const pendingRequests = new Map<string, ProtocolState>();
```

A record is created when sending a request, found via `requestId` when receiving a response, and its status updated.

### Four-Step Protocol Flow

Using shutdown as an example, the full chain:

```
1. Lead sends request
   const requestId = newRequestId();      // "req_004281"
   pendingRequests.set(requestId, { type: "shutdown", status: "pending", /* ... */ });
   bus.send("lead", "alice", "shutdown_request", { requestId })

2. Teammate receives → dispatch
   const inbox = bus.readInbox("alice");
   const messageType = message.type;       // "shutdown_request"
   → routed to handleShutdownRequest()

3. Teammate replies
   bus.send("alice", "lead", "shutdown_response",
            { requestId, approve: true });

4. Lead receives response → match
   matchResponse("shutdown_response", requestId, true);
   pendingRequests.get(requestId)!.status = "approved";
```

`requestId` is the correlation key across the entire chain: the request carries it out, the response carries it back.

### dispatchMessage: Route by Type

A teammate's inbox receives both plain messages and protocol messages. `handleInboxMessage` dispatches by message type:

```ts
function handleInboxMessage(name: string, message: ProtocolMessage, messages: Message[]) {
  const messageType = message.type ?? 'message';
  const requestId = message.metadata?.requestId ?? '';

  if (messageType === 'shutdown_request') {
    bus.send(name, 'lead', 'Shutting down.', 'shutdown_response', {
      requestId,
      approve: true,
    });
    return true; // Stop the loop
  }

  if (messageType === 'plan_approval_response') {
    const approved = Boolean(message.metadata?.approve);
    messages.push({ role: 'user', content: approved ? '[Plan approved]' : '[Plan rejected]' });
  }

  return false; // Continue
}
```

Adding a new protocol type means adding a new `if` branch.

### matchResponse: Type Validation

`matchResponse` doesn't just find state by `requestId`, it also validates that the response type matches the request type:

```ts
function matchResponse(responseType: string, requestId: string, approve: boolean) {
  const state = pendingRequests.get(requestId);
  if (!state) return;
  if (state.type === 'shutdown' && responseType !== 'shutdown_response') return;
  if (state.type === 'plan_approval' && responseType !== 'plan_approval_response') return;
  if (state.status !== 'pending') return;

  state.status = approve ? 'approved' : 'rejected';
}
```

A shutdown_response cannot accidentally approve a plan_approval request.

### Unified Inbox Consumer: consumeLeadInbox

Both the `check_inbox` tool and the main loop call the same `consumeLeadInbox()` function, routing protocol messages before returning remaining content. This prevents messages from being consumed without protocol state updates:

```ts
function consumeLeadInbox(routeProtocol = true) {
  const messages = bus.readInbox('lead');
  if (routeProtocol) {
    for (const message of messages) {
      const requestId = message.metadata?.requestId ?? '';
      const messageType = message.type ?? '';
      if (requestId && messageType.endsWith('_response')) {
        matchResponse(messageType, requestId, Boolean(message.metadata?.approve));
      }
    }
  }
  return messages;
}
```

The main loop also injects inbox messages into `history` so the LLM can see and react to them.

### Teammate Idle Loop: Wait Instead of Exit

s15's teammates exit after 10 rounds. s16's teammates enter idle waiting after the LLM returns a non-tool_use response: poll inbox, respond to shutdown_request and exit, or continue working on new messages.

```
LLM returns non-tool_use
  → idle: poll inbox every second
  → receives shutdown_request → reply shutdown_response → exit
  → receives new message → inject into messages → continue LLM turn
```

Teaching version omits idle_notification to Lead. Real CC sends `idle_notification` when idle, so Lead knows the teammate is free for new tasks.

### Putting It Together

```
1. Lead: "Have Alice create a file, then shut her down"
2. Lead → spawnTeammate("alice", "backend", "Create config.ts")
3. alice thread starts → writeFile("config.ts", "...") → done → idle
4. Lead → requestShutdown("alice")
   → bus.send("shutdown_request", { requestId: "req_000142" })
5. alice idle poll receives → handleShutdownRequest
   → bus.send("shutdown_response", { requestId: "req_000142", approve: true })
6. Lead consumeLeadInbox → matchResponse("req_000142", true)
   → pendingRequests.get("req_000142")!.status = "approved"
   → inbox message injected into history, LLM sees shutdown result
```

Shutdown handshake complete: request → confirm → shutdown. Every step tracked by `requestId`.

---

## Changes from s15

| Component | Before (s15) | After (s16) |
|-----------|-------------|-------------|
| Coordination | Loose text messages | Structured request-response protocol |
| Request tracking | None | ProtocolState + pending_requests dict |
| Message routing | All treated as text | dispatchMessage routes by type |
| Shutdown | Natural exit or kill thread | requestId handshake mechanism |
| Plan approval | None | Message flow example (no execution gating) |
| New message types | message, result | + shutdown_request/response, plan_approval_request/response |
| Teammate lifecycle | Max 10 rounds | Idle loop (waits for inbox messages) |
| Lead inbox | check_inbox and main loop read separately | Unified consumeLeadInbox |
| Lead tools | 14 (s15) | 14 (core tool set plus request_shutdown, request_plan, review_plan) |
| Teammate tools | 4 (s15) | + submit_plan (5) |

---


## What's Next

In s15-s16, Lead must assign tasks to each teammate. "Alice does this, Bob does that." With 10 unclaimed tasks on the board, Lead has to manually assign each one.

What if teammates could check the board and claim tasks themselves? Lead only needs to create tasks; teammates discover, claim, and complete them on their own.

s17 Autonomous Agents → Self-organizing teammates, no leader assignment needed.

<details>
<summary>Deep Dive into CC Source</summary>

CC's team protocol implementation (`teammateMailbox.ts`, 1184 lines) shares the same core structure as the teaching version: requestId + approve/reject request-response pattern. Differences:

**Shutdown protocol**: CC's shutdown is three-way communication (`teammateMailbox.ts:720-763`, `SendMessageTool.ts:268-430`). Lead sends `shutdown_request`, teammate replies `shutdown_approved` (or `shutdown_rejected` with reason), system sends `teammate_terminated` to notify all parties. After confirmation, system cleans up pane (tmux/iTerm2), unassigns tasks, removes member from team config (`useInboxPoller.ts:677-800`). Teaching version uses `shutdown_response` as a unified name; real source splits into `shutdown_approved` and `shutdown_rejected` as two separate message types.

**Plan approval**: In the real source, plan approval request is generated by `ExitPlanModeV2Tool.ts:263-312` when a plan-mode-required teammate exits plan mode. `useInboxPoller.ts:599-661` currently auto-writes approval and passes the request to Lead as context (regular message). `SendMessageTool.ts:434-518` retains explicit approve/reject response capability — approval can simultaneously set `permissionMode` (e.g. "approved but run in plan mode"), response can include `feedback` string for teammate to revise and resubmit. Not a simple "Lead manually uses review_plan tool" flow.

**Message format**: CC's protocol messages are structured JSON (with Zod schema validation), teaching version uses simple type + metadata dict. Field names are also inconsistent: permission uses `requestId` (`teammateMailbox.ts:453-462`), shutdown and plan approval use `requestId` (`teammateMailbox.ts:684-763`).

**Execution gating**: CC's teammates have full permission gating. Unapproved high-risk operations are intercepted, not optional. Teaching version only demonstrates the message flow without execution interception.

**Generality**: Teaching version's single FSM (pending → approved | rejected) maps to two protocols. This simplification is correct. CC's protocol messages all share the same request id correlation mechanism.

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
