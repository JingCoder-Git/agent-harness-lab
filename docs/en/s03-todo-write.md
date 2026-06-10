# s03: TodoWrite

`s01 > s02 > [ s03 ] s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"An agent without a plan drifts"* -- list the steps first, then execute.
>
> **Harness layer**: Planning -- keeping the model on course without scripting the route.

## Problem

On multi-step tasks, the model loses track. It repeats work, skips steps, or wanders off. Long conversations make this worse -- the system prompt fades as tool results fill the context. A 10-step refactoring might complete steps 1-3, then the model starts improvising because it forgot steps 4-10.

## Solution

```
+--------+      +-------+      +---------+
|  User  | ---> |  LLM  | ---> | Tools   |
| prompt |      |       |      | + todo  |
+--------+      +---+---+      +----+----+
                    ^                |
                    |   tool_result  |
                    +----------------+
                          |
              +-----------+-----------+
              | TodoManager state     |
              | [ ] task A            |
              | [>] task B  <- doing  |
              | [x] task C            |
              +-----------------------+
                          |
              if rounds_since_todo >= 3:
                inject <reminder> into tool_result
```

## How It Works

1. TodoManager stores items with statuses. Only one item can be `in_progress` at a time.

```ts
type TodoStatus = 'pending' | 'in_progress' | 'completed';
type TodoItem = { id: string; text: string; status?: TodoStatus };

class TodoManager {
  private items: Required<TodoItem>[] = [];

  update(items: TodoItem[]) {
    let inProgressCount = 0;
    const validated = items.map((item) => {
      const status = item.status ?? 'pending';
      if (status === 'in_progress') inProgressCount += 1;
      return { id: item.id, text: item.text, status };
    });

    if (inProgressCount > 1) throw new Error('Only one task can be in_progress');
    this.items = validated;
    return this.render();
  }

  render() {
    return this.items.map((item) => `[${item.status}] ${item.text}`).join('\n');
  }
}
```

2. The `todo` tool goes into the dispatch map like any other tool.

```ts
const toolHandlers: Record<string, ToolHandler> = {
  ...baseToolHandlers,
  todo: (input) => todoManager.update(input.items as TodoItem[]),
};
```

3. A nag reminder injects a nudge if the model goes 3+ rounds without calling `todo`.

```ts
if (roundsSinceTodo >= 3 && messages.length > 0) {
  const last = messages.at(-1);
  if (last?.role === 'user' && Array.isArray(last.content)) {
    last.content.unshift({
      type: 'text',
      text: '<reminder>Update your todos.</reminder>',
    });
  }
}
```

The "one in_progress at a time" constraint forces sequential focus. The nag reminder creates accountability.

## What Changed From s02

| Component      | Before (s02)     | After (s03)                |
|----------------|------------------|----------------------------|
| Tools          | 4                | 5 (+todo)                  |
| Planning       | None             | TodoManager with statuses  |
| Nag injection  | None             | `<reminder>` after 3 rounds|
| Agent loop     | Simple dispatch  | + rounds_since_todo counter|


