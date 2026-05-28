type Message = { role: "user" | "assistant" | "tool"; content: string };

type ToolCall = {
  name: "bash";
  input: { command: string };
};

type ModelResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "tool_use" | "end_turn";
};

const tools = {
  bash: async ({ command }: { command: string }) => `executed: ${command}`,
};

async function callModel(messages: Message[]): Promise<ModelResponse> {
  const last = messages.at(-1)?.content ?? "";
  if (last.includes("hello")) {
    return {
      text: "I will inspect the workspace first.",
      toolCalls: [{ name: "bash", input: { command: "ls" } }],
      stopReason: "tool_use",
    };
  }
  return { text: "Done.", toolCalls: [], stopReason: "end_turn" };
}

async function agentLoop(messages: Message[]) {
  while (true) {
    const response = await callModel(messages);
    messages.push({ role: "assistant", content: response.text });

    if (response.stopReason !== "tool_use") break;

    for (const toolCall of response.toolCalls) {
      const result = await tools[toolCall.name](toolCall.input);
      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}

agentLoop([{ role: "user", content: "hello" }]);

export {};
