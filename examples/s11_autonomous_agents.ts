type Task = { id: number; title: string; owner?: string; status: "ready" | "claimed" };

function createAutonomousWorker(name: string) {
  function scan(tasks: Task[]) {
    return tasks.find((task) => task.status === "ready" && !task.owner);
  }

  function claim(task: Task) {
    return { ...task, owner: name, status: "claimed" as const };
  }

  async function tick(tasks: Task[]) {
    const task = scan(tasks);
    if (!task) return "idle";
    return claim(task);
  }

  return { scan, claim, tick };
}

createAutonomousWorker("tester").tick([
  { id: 1, title: "Add API tests", status: "ready" },
]);

export {};
