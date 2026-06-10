type ProtocolType =
  | "message"
  | "shutdown_request"
  | "shutdown_response"
  | "plan_approval_request"
  | "plan_approval_response";

type ProtocolMessage = {
  from: string;
  to: string;
  type: ProtocolType;
  content: string;
  metadata?: { requestId?: string; approve?: boolean };
};

type ProtocolState = {
  requestId: string;
  type: "shutdown" | "plan_approval";
  sender: string;
  target: string;
  status: "pending" | "approved" | "rejected";
  payload: string;
  createdAt: number;
};

class MessageBus {
  private inboxes = new Map<string, ProtocolMessage[]>();

  send(message: ProtocolMessage) {
    const inbox = this.inboxes.get(message.to) ?? [];
    inbox.push(message);
    this.inboxes.set(message.to, inbox);
  }

  readInbox(agent: string) {
    const inbox = this.inboxes.get(agent) ?? [];
    this.inboxes.delete(agent);
    return inbox;
  }
}

const bus = new MessageBus();
const pendingRequests = new Map<string, ProtocolState>();

function newRequestId() {
  return `req_${String(pendingRequests.size + 1).padStart(6, "0")}`;
}

function matchResponse(responseType: ProtocolType, requestId: string, approve: boolean) {
  const state = pendingRequests.get(requestId);
  if (!state || state.status !== "pending") return;
  if (state.type === "shutdown" && responseType !== "shutdown_response") return;
  if (state.type === "plan_approval" && responseType !== "plan_approval_response") return;

  state.status = approve ? "approved" : "rejected";
}

function requestShutdown(teammate: string) {
  const requestId = newRequestId();
  pendingRequests.set(requestId, {
    requestId,
    type: "shutdown",
    sender: "lead",
    target: teammate,
    status: "pending",
    payload: "Please finish current work and shut down.",
    createdAt: Date.now(),
  });
  bus.send({
    from: "lead",
    to: teammate,
    type: "shutdown_request",
    content: "Please shut down gracefully.",
    metadata: { requestId },
  });
  return requestId;
}

function submitPlan(from: string, plan: string) {
  const requestId = newRequestId();
  pendingRequests.set(requestId, {
    requestId,
    type: "plan_approval",
    sender: from,
    target: "lead",
    status: "pending",
    payload: plan,
    createdAt: Date.now(),
  });
  bus.send({
    from,
    to: "lead",
    type: "plan_approval_request",
    content: plan,
    metadata: { requestId },
  });
  return requestId;
}

function dispatchMessage(agent: string, message: ProtocolMessage) {
  const requestId = message.metadata?.requestId ?? "";

  if (message.type === "shutdown_request") {
    bus.send({
      from: agent,
      to: "lead",
      type: "shutdown_response",
      content: "Shutdown approved.",
      metadata: { requestId, approve: true },
    });
    return "stop";
  }

  if (message.type === "plan_approval_response") {
    return message.metadata?.approve ? "plan approved" : "plan rejected";
  }

  return "continue";
}

function consumeLeadInbox() {
  const messages = bus.readInbox("lead");
  for (const message of messages) {
    const requestId = message.metadata?.requestId;
    if (requestId && message.type.endsWith("_response")) {
      matchResponse(message.type, requestId, Boolean(message.metadata?.approve));
    }
  }
  return messages;
}

const shutdownId = requestShutdown("alice");
for (const message of bus.readInbox("alice")) dispatchMessage("alice", message);
consumeLeadInbox();

const planId = submitPlan("bob", "Refactor auth in three small commits.");
bus.send({
  from: "lead",
  to: "bob",
  type: "plan_approval_response",
  content: "Approved.",
  metadata: { requestId: planId, approve: true },
});

export { shutdownId, planId };
