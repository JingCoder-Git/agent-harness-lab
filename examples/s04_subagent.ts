type Message = { role: "user" | "assistant" | "tool"; content: string };

async function runAgent(messages: Message[]) {
  return `summary from ${messages.length} messages`;
}

async function spawnSubagent(task: string) {
  const childMessages: Message[] = [
    { role: "user", content: task },
  ];

  return runAgent(childMessages);
}

async function parentAgent() {
  const parentMessages: Message[] = [
    { role: "user", content: "Refactor the auth module" },
  ];

  const testSummary = await spawnSubagent("Write tests for auth edge cases");
  parentMessages.push({ role: "tool", content: testSummary });

  return parentMessages;
}

parentAgent();

export {};
