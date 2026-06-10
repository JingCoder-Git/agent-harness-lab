type MessageType = "message" | "result";

type InboxMessage = {
  from: string;
  to: string;
  type: MessageType;
  content: string;
  timestamp: number;
};

type Teammate = {
  name: string;
  role: string;
  prompt: string;
  rounds: number;
};

class MessageBus {
  private inboxes = new Map<string, InboxMessage[]>();

  send(from: string, to: string, content: string, type: MessageType = "message") {
    const inbox = this.inboxes.get(to) ?? [];
    inbox.push({ from, to, type, content, timestamp: Date.now() });
    this.inboxes.set(to, inbox);
  }

  readInbox(agent: string) {
    const inbox = this.inboxes.get(agent) ?? [];
    this.inboxes.delete(agent);
    return inbox;
  }
}

const bus = new MessageBus();
const activeTeammates = new Map<string, Teammate>();

function spawnTeammateThread(name: string, role: string, prompt: string) {
  const teammate = { name, role, prompt, rounds: 0 };
  activeTeammates.set(name, teammate);
  bus.send("lead", name, prompt);
  return `Spawned ${name} as ${role}`;
}

function teammateTurn(name: string) {
  const teammate = activeTeammates.get(name);
  if (!teammate) return `${name} is not active`;

  const inbox = bus.readInbox(name);
  teammate.rounds += 1;

  const assignment = inbox.map((message) => message.content).join("\n");
  const summary = `${name} handled: ${assignment || teammate.prompt}`;
  bus.send(name, "lead", summary, "result");

  if (teammate.rounds >= 10) {
    activeTeammates.delete(name);
  }

  return summary;
}

function checkInbox() {
  return bus.readInbox("lead").map((message) => ({
    from: message.from,
    type: message.type,
    content: message.content,
  }));
}

spawnTeammateThread("alice", "backend developer", "Create schema.sql");
teammateTurn("alice");
checkInbox();

export {};
