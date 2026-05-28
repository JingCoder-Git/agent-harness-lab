# s01: The Agent Loop

`[ s01 ] s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"One loop & Bash is all you need"* -- one tool + one loop = an agent.
>
> **Harness layer**: The loop -- the model's first connection to the real world.

## Course Overview: Agent and Harness

This course focuses on the engineering layer around an AI model. The model understands, reasons, and chooses actions. The harness gives that model an observable, executable, recoverable, and permissioned environment.

An agent product is not a pile of if/else routing, prompt chains, or workflow nodes. The model carries the learned capacity to act. What we build in application code is the harness:

```text
Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions
```

This refactor uses Next.js + TypeScript because the product is a learning application: documentation, interactive visualizations, source reading, and progress persistence fit naturally in one Next.js app. A separate Node.js service is not needed yet because there is no long-running queue, database-backed multi-user state, or external scheduler. Node remains present through Next.js, build scripts, and the TypeScript reference implementations.

The course is organized as 12 steps:

| Step | Topic | Harness mechanism |
|------|-------|-------------------|
| 1 | Agent Loop | Minimal model-tool-result loop |
| 2 | Tool Use | Tool registration and dispatch |
| 3 | TodoWrite | Plan before execution |
| 4 | Subagent | Isolated context per subtask |
| 5 | Skills | On-demand knowledge loading |
| 6 | Context Compact | Compression for long sessions |
| 7 | Task System | Persistent task graph |
| 8 | Background Tasks | Non-blocking work |
| 9 | Agent Teams | Multi-agent mailboxes |
| 10 | Team Protocols | Request-response protocols |
| 11 | Autonomous Agents | Scan and claim work |
| 12 | Worktree Isolation | Task-scoped execution directories |

Each step keeps the original visualization, simulator, source, and deep-dive interactions. The surrounding UI is now step-based: finish the current module, move to the next step, go backward or forward at any time, and keep the current step in LocalStorage.

## Problem

A language model can reason about code, but it can't *touch* the real world -- can't read files, run tests, or check errors. Without a loop, every tool call requires you to manually copy-paste results back. You become the loop.

## Solution

```
+--------+      +-------+      +---------+
|  User  | ---> |  LLM  | ---> |  Tool   |
| prompt |      |       |      | execute |
+--------+      +---+---+      +----+----+
                    ^                |
                    |   tool_result  |
                    +----------------+
                    (loop until stop_reason != "tool_use")
```

One exit condition controls the entire flow. The loop runs until the model stops calling tools.

## How It Works

1. User prompt becomes the first message.

```python
messages.append({"role": "user", "content": query})
```

2. Send messages + tool definitions to the LLM.

```python
response = client.messages.create(
    model=MODEL, system=SYSTEM, messages=messages,
    tools=TOOLS, max_tokens=8000,
)
```

3. Append the assistant response. Check `stop_reason` -- if the model didn't call a tool, we're done.

```python
messages.append({"role": "assistant", "content": response.content})
if response.stop_reason != "tool_use":
    return
```

4. Execute each tool call, collect results, append as a user message. Loop back to step 2.

```python
results = []
for block in response.content:
    if block.type == "tool_use":
        output = run_bash(block.input["command"])
        results.append({
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": output,
        })
messages.append({"role": "user", "content": results})
```

Assembled into one function:

```python
def agent_loop(query):
    messages = [{"role": "user", "content": query}]
    while True:
        response = client.messages.create(
            model=MODEL, system=SYSTEM, messages=messages,
            tools=TOOLS, max_tokens=8000,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return

        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = run_bash(block.input["command"])
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output,
                })
        messages.append({"role": "user", "content": results})
```

That's the entire agent in under 30 lines. Everything else in this course layers on top -- without changing the loop.

## What Changed

| Component     | Before     | After                          |
|---------------|------------|--------------------------------|
| Agent loop    | (none)     | `while True` + stop_reason     |
| Tools         | (none)     | `bash` (one tool)              |
| Messages      | (none)     | Accumulating list              |
| Control flow  | (none)     | `stop_reason != "tool_use"`    |

