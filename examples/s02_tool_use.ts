type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

const toolRegistry: Record<string, ToolHandler> = {
  bash: async (input) => `shell: ${input.command}`,
  readFile: async (input) => `file: ${input.path}`,
  writeFile: async (input) => `wrote: ${input.path}`,
};

async function dispatchTool(name: string, input: Record<string, unknown>) {
  const handler = toolRegistry[name];
  if (!handler) return `Unknown tool: ${name}`;
  return handler(input);
}

async function runToolTurn() {
  const toolCall = {
    name: "readFile",
    input: { path: "README.md" },
  };

  return dispatchTool(toolCall.name, toolCall.input);
}

runToolTurn();

export {};
