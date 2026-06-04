type TaskStatus = "running" | "completed" | "failed";

type BackgroundTask = {
  id: string;
  command: string;
  status: TaskStatus;
  result?: string;
};

type Notification = {
  taskId: string;
  content: string;
};

function createBackgroundRuntime() {
  let counter = 0;
  const tasks = new Map<string, BackgroundTask>();
  let notifications: Notification[] = [];

  function shouldRunBackground(toolName: string, input: { timeoutMs?: number }) {
    return toolName === "bash" && (input.timeoutMs ?? 0) > 1_000;
  }

  function startBackgroundTask(command: string, work: () => Promise<string>) {
    counter += 1;
    const id = `bg-${counter}`;
    tasks.set(id, { id, command, status: "running" });

    void work()
      .then((result) => {
        tasks.set(id, { id, command, status: "completed", result });
        notifications.push({ taskId: id, content: result });
      })
      .catch((error: Error) => {
        const result = error.message;
        tasks.set(id, { id, command, status: "failed", result });
        notifications.push({ taskId: id, content: result });
      });

    return { taskId: id, message: "started in background" };
  }

  function collectBackgroundResults() {
    const ready = notifications;
    notifications = [];
    return ready;
  }

  function getTask(id: string) {
    return tasks.get(id);
  }

  return { shouldRunBackground, startBackgroundTask, collectBackgroundResults, getTask };
}

async function runToolTurn() {
  const runtime = createBackgroundRuntime();
  const toolCall = { name: "bash", input: { command: "npm run build", timeoutMs: 5_000 } };

  if (runtime.shouldRunBackground(toolCall.name, toolCall.input)) {
    return runtime.startBackgroundTask(toolCall.input.command, async () => "build completed");
  }

  return { output: "ran in foreground" };
}

void runToolTurn();

export {};
