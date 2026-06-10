type TaskStatus = "pending" | "in_progress" | "completed";

type Task = {
  id: string;
  subject: string;
  status: TaskStatus;
  owner: string | null;
  blockedBy: string[];
};

type AgentState = "WORK" | "IDLE" | "SHUTDOWN";
type InboxMessage = { type: "message" | "shutdown_request"; content: string };

function createTaskBoard(initialTasks: Task[]) {
  const tasks = new Map(initialTasks.map((task) => [task.id, task]));

  function canStart(task: Task) {
    return task.blockedBy.every((id) => tasks.get(id)?.status === "completed");
  }

  function scanUnclaimedTasks() {
    return [...tasks.values()].filter(
      (task) => task.status === "pending" && !task.owner && canStart(task)
    );
  }

  function claimTask(taskId: string, owner: string) {
    const task = tasks.get(taskId);
    if (!task) return `Task ${taskId} not found`;
    if (task.status !== "pending") return `Task ${taskId} is ${task.status}`;
    if (task.owner) return `Task ${taskId} already owned by ${task.owner}`;
    if (!canStart(task)) return `Task ${taskId} is blocked`;

    task.owner = owner;
    task.status = "in_progress";
    return `Claimed ${task.id} (${task.subject})`;
  }

  function completeTask(taskId: string) {
    const task = tasks.get(taskId);
    if (!task || task.status !== "in_progress") return `Cannot complete ${taskId}`;
    task.status = "completed";
    return `Completed ${task.id}`;
  }

  return { scanUnclaimedTasks, claimTask, completeTask };
}

function reinjectIdentity(messages: string[], name: string, role: string) {
  if (messages.length <= 3) {
    messages.unshift(`<identity>You are ${name}, role: ${role}. Continue your work.</identity>`);
  }
}

function idlePoll(
  name: string,
  inbox: InboxMessage[],
  board: ReturnType<typeof createTaskBoard>
): { state: AgentState; taskId?: string } {
  const shutdown = inbox.find((message) => message.type === "shutdown_request");
  if (shutdown) return { state: "SHUTDOWN" };

  const [task] = board.scanUnclaimedTasks();
  if (!task) return { state: "IDLE" };

  const result = board.claimTask(task.id, name);
  return result.startsWith("Claimed") ? { state: "WORK", taskId: task.id } : { state: "IDLE" };
}

const board = createTaskBoard([
  { id: "task-1", subject: "Create schema", status: "pending", owner: null, blockedBy: [] },
  { id: "task-2", subject: "Write API routes", status: "pending", owner: null, blockedBy: [] },
]);

const messages: string[] = [];
reinjectIdentity(messages, "alice", "backend developer");
const next = idlePoll("alice", [], board);
if (next.taskId) board.completeTask(next.taskId);

export {};
