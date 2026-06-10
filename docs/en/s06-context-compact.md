# s06: Context Compact

`s01 > s02 > s03 > s04 > s05 > [ s06 ] | s07 > s08 > s09 > s10 > s11 > s12`

> *"Context will fill up; you need a way to make room"* -- three-layer compression strategy for infinite sessions.
>
> **Harness layer**: Compression -- clean memory for infinite sessions.

## Problem

The context window is finite. A single `read_file` on a 1000-line file costs ~4000 tokens. After reading 30 files and running 20 bash commands, you hit 100,000+ tokens. The agent cannot work on large codebases without compression.

## Solution

Three layers, increasing in aggressiveness:

```
Every turn:
+------------------+
| Tool call result |
+------------------+
        |
        v
[Layer 1: micro_compact]        (silent, every turn)
  Replace tool_result > 3 turns old
  with "[Previous: used {tool_name}]"
        |
        v
[Check: tokens > 50000?]
   |               |
   no              yes
   |               |
   v               v
continue    [Layer 2: auto_compact]
              Save transcript to .transcripts/
              LLM summarizes conversation.
              Replace all messages with [summary].
                    |
                    v
            [Layer 3: compact tool]
              Model calls compact explicitly.
              Same summarization as auto_compact.
```

## How It Works

1. **Layer 1 -- micro_compact**: Before each LLM call, replace old tool results with placeholders.

```ts
function microCompact(messages: Message[]) {
  const toolResults: ToolResultPart[] = [];

  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'tool_result') toolResults.push(part);
    }
  }

  if (toolResults.length <= KEEP_RECENT) return messages;

  for (const part of toolResults.slice(0, -KEEP_RECENT)) {
    if (String(part.content ?? '').length > 100) {
      part.content = `[Previous: used ${part.name ?? 'tool'}]`;
    }
  }
  return messages;
}
```

2. **Layer 2 -- auto_compact**: When tokens exceed threshold, save full transcript to disk, then ask the LLM to summarize.

```ts
async function autoCompact(messages: Message[]) {
  const transcriptPath = path.join(
    transcriptDir,
    `transcript_${Date.now()}.jsonl`
  );
  await fs.writeFile(
    transcriptPath,
    messages.map((message) => JSON.stringify(message)).join('\n')
  );

  const response = await client.messages.create({
    model,
    messages: [{
      role: 'user',
      content: 'Summarize this conversation for continuity...'
        + JSON.stringify(messages).slice(0, 80_000),
    }],
    max_tokens: 2000,
  });

  return [{ role: 'user', content: `[Compressed]\n\n${response.content[0].text}` }];
}
```

3. **Layer 3 -- manual compact**: The `compact` tool triggers the same summarization on demand.

4. The loop integrates all three:

```ts
async function agentLoop(messages: Message[]) {
  while (true) {
    microCompact(messages);                     // Layer 1
    if (estimateTokens(messages) > THRESHOLD) {
      messages.splice(0, messages.length, ...(await autoCompact(messages))); // Layer 2
    }

    const response = await callModel(messages);
    await executeTools(response, messages);

    if (manualCompactRequested(response)) {
      messages.splice(0, messages.length, ...(await autoCompact(messages))); // Layer 3
    }
  }
}
```

Transcripts preserve full history on disk. Nothing is truly lost -- just moved out of active context.

## What Changed From s05

| Component      | Before (s05)     | After (s06)                |
|----------------|------------------|----------------------------|
| Tools          | 5                | 5 (base + compact)         |
| Context mgmt   | None             | Three-layer compression    |
| Micro-compact  | None             | Old results -> placeholders|
| Auto-compact   | None             | Token threshold trigger    |
| Transcripts    | None             | Saved to .transcripts/     |

