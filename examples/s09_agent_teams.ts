type Mail = { from: string; to: string; body: string };

function createMailbox() {
  const mail: Mail[] = [];

  function send(message: Mail) {
    mail.push(message);
  }

  function receive(agent: string) {
    return mail.filter((message) => message.to === agent);
  }

  return { send, receive };
}

async function leadAgent(mailbox: ReturnType<typeof createMailbox>) {
  mailbox.send({
    from: "lead",
    to: "coder",
    body: "Implement the parser and report back.",
  });
}

async function teammateAgent(mailbox: ReturnType<typeof createMailbox>) {
  return mailbox.receive("coder").map((message) => message.body);
}

const mailbox = createMailbox();
leadAgent(mailbox).then(() => teammateAgent(mailbox));

export {};
