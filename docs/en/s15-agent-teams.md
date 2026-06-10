# s15: Agent Teams — One Agent Isn't Enough, Form a Team

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

s01 → ... → s13 → s14 → `s15` → [s16](../s16_team_protocols/) → s17 → s18 → s19 → s20
> *"One agent isn't enough, form a team"* — File-based inboxes + teammate threads.
>
> **Harness Layer**: Teams — Multi-agent collaboration, message bus.

---

## The Problem

"Refactor the entire backend" touches auth, database layer, API routes, and tests. One agent working on API routes no longer has auth module details in context. The context window is limited, a single agent can't cover every module.

s06's sub-agents are temps, called in for one job, then gone. Some tasks need teammates that can communicate and collaborate.

---

## The Solution

![Agent Teams Overview](/course-assets/s15_agent_teams/agent-teams-overview.en.svg)

Teaching code carries forward S14's capabilities (prompt assembly, task system, background execution, cron scheduling). To stay focused on the team mechanism, it omits full error recovery, memory, and skill systems. Added: **MessageBus** (file-based inboxes), **spawn_teammate_thread** (launch teammate threads), **inbox injection** (Lead receives teammate messages and injects into history).

Sub-agent vs Teammate:

| | s06 Sub-agent | s15 Teammate |
|---|---|---|
| Lifetime | One-shot, destroyed after use | Multi-turn (teaching: 10 rounds; real CC: idle loop) |
| Communication | Only returns conclusion | Async inbox, communicate anytime |
| Context | Fully isolated | Shared via messages |
| Count | One lead + occasional sub-agent | One Lead + multiple teammates |

---

## How It Works

![Team Topology](/course-assets/s15_agent_teams/team-topology.en.svg)

### MessageBus: File-Based Inboxes

Each agent (including Lead and teammates) has a `.jsonl` inbox. Send = append a JSON line to the target's file. Read = read file + delete (consumption):

```ts
type MessageType = 'message' | 'result';
type InboxMessage = {
  from: string;
  to: string;
  content: string;
  type: MessageType;
  timestamp: number;
};

class MessageBus {
  private inboxes = new Map<string, InboxMessage[]>();

  send(from: string, to: string, content: string, type: MessageType = 'message') {
    const inbox = this.inboxes.get(to) ?? [];
    inbox.push({ from, to, content, type, timestamp: Date.now() });
    this.inboxes.set(to, inbox);
  }

  readInbox(agent: string) {
    const inbox = this.inboxes.get(agent) ?? [];
    this.inboxes.delete(agent);
    return inbox;
  }
}
```

Why files instead of in-memory queues? Teaching code uses files because they're intuitive and observable across threads. Real CC also uses file inboxes (`~/.claude/teams/{team}/inboxes/`) but adds `proper-lockfile` for concurrent write safety. The teaching version's `readInbox` has a read + unlink race, concurrent reads could lose messages, acceptable for teaching purposes.

### spawn_teammate_thread: Launching a Teammate

Lead calls the `spawn_teammate` tool to start a teammate. The teammate runs in its own daemon thread with its own system prompt, messages, and simplified tool set:

```ts
function spawnTeammateThread(name: string, role: string, prompt: string) {
  const system = `You are '${name}', a ${role}. Use tools to complete tasks.`;

  void (async () => {
    const messages: Message[] = [{ role: 'user', content: prompt }];
    const teammateTools = [bashTool, readFileTool, writeFileTool, sendMessageTool];

    for (let round = 0; round < 10; round += 1) {
      const inbox = bus.readInbox(name);
      if (inbox.length > 0) {
        messages.push({ role: 'user', content: `<inbox>${JSON.stringify(inbox)}</inbox>` });
      }

      const response = await callModel({ system, messages: messages.slice(-20), tools: teammateTools });
      await executeTools(response, messages);
    }

    bus.send(name, 'lead', summarize(messages), 'result');
  })();

  return `Spawned ${name} as ${role}`;
}
```

Key design:
- **Simplified tool set**: bash, read, write, send_message. Teaching code omits tasks and cron to focus on communication. Real CC teammates also have TaskCreate, TaskUpdate, etc., the task system is shared across the team
- **Teaching: 10 rounds max**: prevents infinite loops. Real CC uses idle loop: after each round, send `idle_notification`, wait for inbox messages, resume on arrival, exit only on `shutdown_request`
- **Auto-report on completion**: `bus.send(name, "lead", summary)` sends the final result to Lead's inbox

### Lead's Inbox Injection

Lead checks inbox after each main loop iteration. Teammate messages are injected into history so the LLM can see and react to them:

```ts
const inbox = bus.readInbox('lead');
if (inbox.length > 0) {
  const inboxText = inbox
    .map((message) => `From ${message.from}: ${message.content.slice(0, 200)}`)
    .join('\n');
  history.push({ role: 'user', content: `[Inbox]\n${inboxText}` });
}
```

Teaching code injects in the user input loop. Real CC is more refined, Lead's `useInboxPoller` checks every 1 second, submitting messages as new turns without waiting for user input.

### Permission Bubbling

Teaching code omits permission bubbling. Real CC's flow (`permissionSync.ts`, `useSwarmPermissionPoller.ts`):

1. Teammate encounters an operation needing approval → sends `permission_request` to Lead's inbox
2. Lead's `useInboxPoller` detects the request → routes to approval queue
3. User approves → Lead sends `permission_response` back to teammate
4. Teammate's `useSwarmPermissionPoller` (polls every 500ms) receives reply → continue or reject

### Putting It Together

```
1. Lead: "Build the backend: one agent isn't enough, form a team"
2. Lead → spawnTeammate("alice", "backend dev", "Create database schema")
3. Lead → spawnTeammate("bob", "frontend dev", "Write API client")
4. Alice thread starts → her own LLM call → bash "npm run migrate"
5. Bob thread starts → his own LLM call → writeFile("client.ts", ...)
6. Alice done → bus.send("alice", "lead", "Schema done: users, orders tables")
7. Bob done → bus.send("bob", "lead", "Client written with types")
8. Lead next iteration → inbox injected into history → LLM sees both results
```

Two teammates work in parallel.

---

## Changes from s14

| Component | Before (s14) | After (s15) |
|-----------|-------------|-------------|
| Agent count | 1 | 1 Lead + N teammate threads |
| Communication | None | MessageBus + .mailboxes/*.jsonl |
| New classes | — | MessageBus, active_teammates dict |
| New functions | — | spawn_teammate_thread, run_send_message, run_check_inbox |
| Lead tools | 11 (s14) | + spawn_teammate, send_message, check_inbox (14) |
| Teammate tools | — | bash, read_file, write_file, send_message (4) |
| Permissions | Local decisions | Teaching code omits (real CC has bubbling) |

---


## What's Next

Teammates can work and communicate. But if Lead wants Alice to shut down, killing the thread outright could leave half-written files. A graceful shutdown protocol is needed: Lead sends shutdown_request, teammate wraps up and exits.

s16 Team Protocols → Shutdown handshake and message conventions.

<details>
<summary>Deep Dive into CC Source</summary>

> The following is a complete analysis based on CC source code `spawnMultiAgent.ts`, `useInboxPoller.ts` (969 lines), `useSwarmPermissionPoller.ts` (330 lines), `teammateMailbox.ts`, `teamHelpers.ts`.

### 1. No Central Message Bus, It's the Filesystem

Teaching code uses a `MessageBus` class to send and receive messages. Real CC is more direct, each agent writes directly to other agents' inbox files.

Inbox path: `~/.claude/teams/{teamName}/inboxes/{agentName}.json`

Writes use `proper-lockfile` for concurrent write safety (up to 10 retries). Each file is a JSON array; appending reads → appends → writes back.

### 2. 15 Message Types

CC team communication has 15 structured message types (`teammateMailbox.ts`):

| Type | Direction | Purpose |
|------|-----------|---------|
| `plain text` | Both ways | Normal inter-teammate communication |
| `idle_notification` | Teammate→Lead | Teammate finished a turn, now idle |
| `permission_request` | Teammate→Lead | Teammate needs operation approval |
| `permission_response` | Lead→Teammate | Lead's approval result |
| `plan_approval_request` | Teammate→Lead | Teammate submits plan for review |
| `plan_approval_response` | Lead→Teammate | Lead's plan review |
| `shutdown_request` | Lead→Teammate | Request graceful shutdown |
| `shutdown_approved` | Teammate→Lead | Confirm shutdown |
| `shutdown_rejected` | Teammate→Lead | Reject shutdown (with reason) |
| `task_assignment` | Lead→Teammate | Assign a task |
| `team_permission_update` | Lead→Teammate | Broadcast permission changes |
| `mode_set_request` | Lead→Teammate | Change teammate's permission mode |
| `sandbox_permission_*` | Both ways | Network permission request/reply |
| `teammate_terminated` | System | Teammate removed notification |

Text messages are wrapped in `<teammate-message>` XML tags for delivery to the model.

### 3. Permission Bubbling: Bidirectional Polling

Teaching code omits permission bubbling. Real CC's flow (`permissionSync.ts`):

1. **Teammate** encounters operation needing approval → sends `permission_request` to Lead's inbox
2. **Lead's** `useInboxPoller` (polls every 1s) detects request → routes to `ToolUseConfirmQueue`
3. Lead's UI shows approval dialog with teammate name and color
4. User approves → Lead sends `permission_response` back to teammate's inbox
5. **Teammate's** `useSwarmPermissionPoller` (polls every 500ms) receives reply → continue or reject

### 4. Teammate Lifecycle

CC teammates are created by `spawnTeammate()` (`spawnMultiAgent.ts`):

1. **Spawn**: Create tmux pane (or in-process), assign color, write team config
2. **Work**: `useInboxPoller` checks inbox every 1s → submit as new turn when messages arrive
3. **Idle**: Stop hook fires → send `idle_notification` to Lead
4. **Shutdown**: Lead sends `shutdown_request` → teammate replies `shutdown_approved` → Lead cleans up

### 5. Team Config

Team registry at `~/.claude/teams/{teamName}/config.json` (`teamHelpers.ts`):

```json
{
  "name": "my-team",
  "leadAgentId": "lead@my-team",
  "members": [{
    "agentId": "researcher@my-team",
    "name": "researcher",
    "agentType": "general-purpose",
    "color": "blue",
    "isActive": true
  }]
}
```

Teammates cannot be nested (`AgentTool.tsx:273` explicitly forbids "teammates spawning other teammates").

</details>

<!-- translation-sync: zh@v1, en@v1, ja@v1 -->
