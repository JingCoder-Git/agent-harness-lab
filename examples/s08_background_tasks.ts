type Notification = { id: string; result: string };

function createBackgroundManager() {
  let notifications: Notification[] = [];

  function run(id: string, work: () => Promise<string>) {
    work().then((result) => {
      notifications.push({ id, result });
    });
  }

  function drain() {
    const pending = notifications;
    notifications = [];
    return pending;
  }

  return { run, drain };
}

async function agentTurn(background: ReturnType<typeof createBackgroundManager>) {
  background.run("tests", async () => "47 passed, 2 failed");
  const notifications = background.drain();
  return notifications.map((item) => `[${item.id}] ${item.result}`);
}

agentTurn(createBackgroundManager());

export {};
