type TaskStatus = "pending" | "in_progress" | "completed";

type Task = {
  id: string;
  subject: string;
  status: TaskStatus;
  owner: string | null;
  blockedBy: string[];
  worktree?: string;
};

type WorktreeEvent = {
  type: "create" | "keep" | "remove";
  worktree: string;
  taskId?: string;
  timestamp: number;
};

const validWorktreeName = /^[A-Za-z0-9._-]{1,64}$/;

function validateWorktreeName(name: string) {
  if (!name) return "Worktree name cannot be empty";
  if (name === "." || name === "..") return `${name} is not a valid worktree name`;
  if (!validWorktreeName.test(name)) {
    return "Use only letters, digits, dots, underscores, and dashes";
  }
  return null;
}

function createWorktreeRuntime(initialTasks: Task[]) {
  const tasks = new Map(initialTasks.map((task) => [task.id, task]));
  const worktrees = new Map<string, { branch: string; path: string; dirtyFiles: number }>();
  const events: WorktreeEvent[] = [];

  function logEvent(type: WorktreeEvent["type"], worktree: string, taskId?: string) {
    events.push({ type, worktree, taskId, timestamp: Date.now() });
  }

  function bindTaskToWorktree(taskId: string, worktree: string) {
    const task = tasks.get(taskId);
    if (!task) return `Task ${taskId} not found`;
    task.worktree = worktree;
    return `Bound ${taskId} to ${worktree}`;
  }

  function createWorktree(name: string, taskId?: string) {
    const error = validateWorktreeName(name);
    if (error) return { ok: false, error };
    if (worktrees.has(name)) return { ok: false, error: `Worktree ${name} already exists` };

    worktrees.set(name, { branch: `wt/${name}`, path: `.worktrees/${name}`, dirtyFiles: 0 });
    if (taskId) bindTaskToWorktree(taskId, name);
    logEvent("create", name, taskId);
    return { ok: true, path: `.worktrees/${name}` };
  }

  function removeWorktree(name: string, discardChanges = false) {
    const worktree = worktrees.get(name);
    if (!worktree) return `Worktree ${name} not found`;
    if (worktree.dirtyFiles > 0 && !discardChanges) {
      return `Worktree ${name} has changes; keep it or pass discardChanges`;
    }
    worktrees.delete(name);
    logEvent("remove", name);
    return `Removed ${name}`;
  }

  function keepWorktree(name: string) {
    logEvent("keep", name);
    return `Kept ${name} for review`;
  }

  return { createWorktree, bindTaskToWorktree, removeWorktree, keepWorktree, events };
}

const runtime = createWorktreeRuntime([
  { id: "task-auth", subject: "Refactor auth", status: "pending", owner: null, blockedBy: [] },
]);

runtime.createWorktree("auth-refactor", "task-auth");
runtime.keepWorktree("auth-refactor");

export {};
