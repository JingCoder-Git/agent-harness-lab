type Worktree = { name: string; path: string; taskId?: number; status: "active" | "kept" };

function createWorktreeManager() {
  let worktrees: Worktree[] = [];

  function create(name: string, taskId: number) {
    const worktree = {
      name,
      path: `.worktrees/${name}`,
      taskId,
      status: "active" as const,
    };
    worktrees.push(worktree);
    return worktree;
  }

  function keep(name: string) {
    worktrees = worktrees.map((worktree) =>
      worktree.name === name ? { ...worktree, status: "kept" } : worktree
    );
  }

  function list() {
    return worktrees;
  }

  return { create, keep, list };
}

const manager = createWorktreeManager();
manager.create("auth-refactor", 1);

export {};
