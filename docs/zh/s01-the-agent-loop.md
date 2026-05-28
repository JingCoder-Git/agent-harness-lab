# s01: The Agent Loop (Agent 循环)

`[ s01 ] s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"One loop & Bash is all you need"* -- 一个工具 + 一个循环 = 一个 Agent。
>
> **Harness 层**: 循环 -- 模型与真实世界的第一道连接。

## 课程概览: Agent 与 Harness

这门课不把重点放在“用流程图假装智能”上，而是放在 AI 应用真正需要的工程外壳上：模型负责理解、推理和选择行动；Harness 负责把模型放进一个可观察、可执行、可恢复、可控制的环境里。

在一个 AI 应用里，Agent 不是一堆 if/else、节点编排或提示词链。Agent 的行动能力主要来自模型训练。我们能工程化构建的是 Harness，也就是模型周围的应用层：

```text
Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions
```

这也是本项目改成 Next.js + TypeScript 的原因：教程站点、交互可视化、源码阅读和课程进度都适合放在 Next.js 里；当前没有长连接任务、数据库队列或独立调度器，所以不需要额外拆一个 Node.js 后端服务。Node 能力通过 Next.js 的构建、脚本和 TypeScript 示例承担，等课程未来需要真实 API、后台任务或多用户状态时，再加独立 Node 服务才有必要。

你会按 STEP 学习 12 个 Harness 机制：

| Step | 主题 | 你要掌握的机制 |
|------|------|----------------|
| 1 | Agent Loop | 模型-工具-结果的最小闭环 |
| 2 | Tool Use | 工具注册与分发 |
| 3 | TodoWrite | 先规划再执行 |
| 4 | Subagent | 子任务上下文隔离 |
| 5 | Skills | 按需加载领域知识 |
| 6 | Context Compact | 上下文压缩与长期会话 |
| 7 | Task System | 可持久化任务图 |
| 8 | Background Tasks | 非阻塞后台执行 |
| 9 | Agent Teams | 多 Agent 邮箱协作 |
| 10 | Team Protocols | 请求-响应协议 |
| 11 | Autonomous Agents | 自主扫描、认领任务 |
| 12 | Worktree Isolation | 按任务隔离执行目录 |

每个 STEP 都保留原来的可视化、模拟器、源码阅读和深挖页签，但课程导航改为 STEP 模式：完成当前模块后进入下一个 STEP；你也可以随时前进、回退，当前 STEP 会保存在浏览器 LocalStorage。

## 问题

语言模型能推理代码, 但碰不到真实世界 -- 不能读文件、跑测试、看报错。没有循环, 每次工具调用你都得手动把结果粘回去。你自己就是那个循环。

## 解决方案

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

一个退出条件控制整个流程。循环持续运行, 直到模型不再调用工具。

## 工作原理

1. 用户 prompt 作为第一条消息。

```python
messages.append({"role": "user", "content": query})
```

2. 将消息和工具定义一起发给 LLM。

```python
response = client.messages.create(
    model=MODEL, system=SYSTEM, messages=messages,
    tools=TOOLS, max_tokens=8000,
)
```

3. 追加助手响应。检查 `stop_reason` -- 如果模型没有调用工具, 结束。

```python
messages.append({"role": "assistant", "content": response.content})
if response.stop_reason != "tool_use":
    return
```

4. 执行每个工具调用, 收集结果, 作为 user 消息追加。回到第 2 步。

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

组装为一个完整函数:

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

不到 30 行, 这就是整个 Agent。后面 11 个章节都在这个循环上叠加机制 -- 循环本身始终不变。

## 变更内容

| 组件          | 之前       | 之后                           |
|---------------|------------|--------------------------------|
| Agent loop    | (无)       | `while True` + stop_reason     |
| Tools         | (无)       | `bash` (单一工具)              |
| Messages      | (无)       | 累积式消息列表                 |
| Control flow  | (无)       | `stop_reason != "tool_use"`    |

