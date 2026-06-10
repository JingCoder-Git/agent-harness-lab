# s06: Context Compact (上下文压缩)

`s01 > s02 > s03 > s04 > s05 > [ s06 ] | s07 > s08 > s09 > s10 > s11 > s12`

> *"上下文总会满, 要有办法腾地方"* -- 三层压缩策略, 换来无限会话。
>
> **Harness 层**: 压缩 -- 干净的记忆, 无限的会话。

## 问题

上下文窗口是有限的。读一个 1000 行的文件就吃掉 ~4000 token; 读 30 个文件、跑 20 条命令, 轻松突破 100k token。不压缩, Agent 根本没法在大项目里干活。

## 解决方案

三层压缩, 激进程度递增:

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

## 工作原理

1. **第一层 -- micro_compact**: 每次 LLM 调用前, 将旧的 tool result 替换为占位符。

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

2. **第二层 -- auto_compact**: token 超过阈值时, 保存完整对话到磁盘, 让 LLM 做摘要。

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

3. **第三层 -- manual compact**: `compact` 工具按需触发同样的摘要机制。

4. 循环整合三层:

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

完整历史通过 transcript 保存在磁盘上。信息没有真正丢失, 只是移出了活跃上下文。

## 相对 s05 的变更

| 组件           | 之前 (s05)       | 之后 (s06)                     |
|----------------|------------------|--------------------------------|
| Tools          | 5                | 5 (基础 + compact)             |
| 上下文管理     | 无               | 三层压缩                       |
| Micro-compact  | 无               | 旧结果 -> 占位符               |
| Auto-compact   | 无               | token 阈值触发                 |
| Transcripts    | 无               | 保存到 .transcripts/           |

