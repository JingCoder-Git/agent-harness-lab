type Todo = {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "completed";
};

function createTodoManager() {
  let todos: Todo[] = [];

  function set(nextTodos: Todo[]) {
    todos = nextTodos;
  }

  function next() {
    return todos.find((todo) => todo.status !== "completed");
  }

  function complete(id: number) {
    todos = todos.map((todo) =>
      todo.id === id ? { ...todo, status: "completed" } : todo
    );
  }

  return { set, next, complete };
}

async function agentTurn(
  todoManager: ReturnType<typeof createTodoManager>,
  userRequest: string
) {
  if (!todoManager.next()) {
    todoManager.set([
      { id: 1, title: `Plan: ${userRequest}`, status: "in_progress" },
      { id: 2, title: "Implement smallest working change", status: "pending" },
      { id: 3, title: "Verify behavior", status: "pending" },
    ]);
  }

  return todoManager.next();
}

agentTurn(createTodoManager(), "build a calculator");

export {};
