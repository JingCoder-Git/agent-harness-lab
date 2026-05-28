type Message = { role: string; content: string; keep?: boolean };

function microCompact(messages: Message[]) {
  return messages.map((message) => {
    if (message.keep || message.role !== "tool") return message;
    return { ...message, content: message.content.slice(0, 120) };
  });
}

async function autoCompact(messages: Message[]) {
  const summary = messages
    .map((message) => `${message.role}: ${message.content.slice(0, 60)}`)
    .join("\n");

  return [{ role: "system", content: `Conversation summary:\n${summary}`, keep: true }];
}

async function compactIfNeeded(messages: Message[], tokenEstimate: number) {
  const trimmed = microCompact(messages);
  if (tokenEstimate < 100_000) return trimmed;
  return autoCompact(trimmed);
}

compactIfNeeded([{ role: "tool", content: "long output ".repeat(50) }], 120_000);

export {};
