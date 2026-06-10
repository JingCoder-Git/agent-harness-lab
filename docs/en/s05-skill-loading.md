# s05: Skills

`s01 > s02 > s03 > s04 > [ s05 ] s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"Load knowledge when you need it, not upfront"* -- inject via tool_result, not the system prompt.
>
> **Harness layer**: On-demand knowledge -- domain expertise, loaded when the model asks.

## Problem

You want the agent to follow domain-specific workflows: git conventions, testing patterns, code review checklists. Putting everything in the system prompt wastes tokens on unused skills. 10 skills at 2000 tokens each = 20,000 tokens, most of which are irrelevant to any given task.

## Solution

```
System prompt (Layer 1 -- always present):
+--------------------------------------+
| You are a coding agent.              |
| Skills available:                    |
|   - git: Git workflow helpers        |  ~100 tokens/skill
|   - test: Testing best practices     |
+--------------------------------------+

When model calls load_skill("git"):
+--------------------------------------+
| tool_result (Layer 2 -- on demand):  |
| <skill name="git">                   |
|   Full git workflow instructions...  |  ~2000 tokens
|   Step 1: ...                        |
| </skill>                             |
+--------------------------------------+
```

Layer 1: skill *names* in system prompt (cheap). Layer 2: full *body* via tool_result (on demand).

## How It Works

1. Each skill is a directory containing a `SKILL.md` with YAML frontmatter.

```
skills/
  pdf/
    SKILL.md       # ---\n name: pdf\n description: Process PDF files\n ---\n ...
  code-review/
    SKILL.md       # ---\n name: code-review\n description: Review code\n ---\n ...
```

2. SkillLoader scans for `SKILL.md` files, uses the directory name as the skill identifier.

```ts
type Skill = { meta: Record<string, string>; body: string };

class SkillLoader {
  private skills = new Map<string, Skill>();

  constructor(private skillsDir: string) {}

  async load() {
    for (const filePath of await findSkillFiles(this.skillsDir)) {
      const text = await fs.readFile(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(text);
      const name = meta.name ?? path.basename(path.dirname(filePath));
      this.skills.set(name, { meta, body });
    }
  }

  getDescriptions() {
    return [...this.skills.entries()]
      .map(([name, skill]) => `  - ${name}: ${skill.meta.description ?? ''}`)
      .join('\n');
  }

  getContent(name: string) {
    return this.skills.get(name)?.body ?? `Skill not found: ${name}`;
  }
}
```

3. Layer 1 goes into the system prompt. Layer 2 is just another tool handler.

```ts
const system = `You are a coding agent at ${workdir}.
Skills available:
${skillLoader.getDescriptions()}`;

const toolHandlers: Record<string, ToolHandler> = {
  ...baseToolHandlers,
  load_skill: (input) => skillLoader.getContent(String(input.name)),
};
```

The model learns what skills exist (cheap) and loads them when relevant (expensive).

## What Changed From s04

| Component      | Before (s04)     | After (s05)                |
|----------------|------------------|----------------------------|
| Tools          | 5 (base + task)  | 5 (base + load_skill)      |
| System prompt  | Static string    | + skill descriptions       |
| Knowledge      | None             | skills/\*/SKILL.md files   |
| Injection      | None             | Two-layer (system + result)|

