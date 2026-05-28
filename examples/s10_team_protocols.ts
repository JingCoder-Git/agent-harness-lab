type ProtocolMessage = {
  requestId: string;
  type: "plan.request" | "plan.response" | "shutdown.request" | "shutdown.response";
  body: string;
};

function createProtocolBus() {
  const messages: ProtocolMessage[] = [];

  function publish(message: ProtocolMessage) {
    messages.push(message);
  }

  function repliesTo(requestId: string) {
    return messages.filter((message) => message.requestId === requestId);
  }

  return { publish, repliesTo };
}

async function requestPlanApproval(
  bus: ReturnType<typeof createProtocolBus>,
  plan: string
) {
  const requestId = crypto.randomUUID();
  bus.publish({ requestId, type: "plan.request", body: plan });
  return requestId;
}

requestPlanApproval(createProtocolBus(), "Refactor auth in three commits");

export {};
