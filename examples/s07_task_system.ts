type TaskStatus = "ready" | "blocked" | "in_progress" | "completed";

type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  blockedBy: number[];
};

function createTaskBoard(initialTasks: Task[]) {
  let tasks = initialTasks;

  function claimNext() {
    return tasks.find(
      (task) => task.status === "ready" && task.blockedBy.length === 0
    );
  }

  function complete(id: number) {
    tasks = tasks.map((task) =>
      task.id === id
        ? { ...task, status: "completed" }
        : { ...task, blockedBy: task.blockedBy.filter((blockedId) => blockedId !== id) }
    );
  }

  return { claimNext, complete };
}

createTaskBoard([
  { id: 1, title: "Create schema", status: "ready", blockedBy: [] },
  { id: 2, title: "Build API", status: "blocked", blockedBy: [1] },
]).claimNext();

export {};
