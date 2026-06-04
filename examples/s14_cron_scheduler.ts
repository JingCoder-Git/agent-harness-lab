type CronJob = {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
};

type QueuedRun = {
  jobId: string;
  prompt: string;
  dueAt: Date;
};

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part, value));
  }
  if (field.includes("/")) {
    const [range, stepText] = field.split("/");
    const step = Number(stepText);
    if (range === "*") return value % step === 0;
    if (range.includes("-")) {
      const [start, end] = range.split("-").map(Number);
      return value >= start && value <= end && (value - start) % step === 0;
    }
  }
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    return value >= start && value <= end;
  }
  return Number(field) === value;
}

function cronMatches(cron: string, date: Date): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(" ");
  const domMatches = fieldMatches(dayOfMonth, date.getDate());
  const dowMatches = fieldMatches(dayOfWeek, date.getDay());
  const dayMatches =
    dayOfMonth !== "*" && dayOfWeek !== "*" ? domMatches || dowMatches : domMatches && dowMatches;

  return (
    fieldMatches(minute, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    dayMatches
  );
}

function createCronScheduler() {
  let counter = 0;
  let jobs: CronJob[] = [];
  let queue: QueuedRun[] = [];

  function scheduleJob(cron: string, prompt: string, recurring = true) {
    counter += 1;
    const job = { id: `cron-${counter}`, cron, prompt, recurring, durable: true };
    jobs = [...jobs, job];
    return job;
  }

  function cancelJob(id: string) {
    jobs = jobs.filter((job) => job.id !== id);
  }

  function tick(now: Date) {
    for (const job of jobs) {
      if (cronMatches(job.cron, now)) {
        queue.push({ jobId: job.id, prompt: job.prompt, dueAt: now });
      }
    }
  }

  function consumeQueue() {
    const due = queue;
    queue = [];
    return due;
  }

  return { scheduleJob, cancelJob, tick, consumeQueue };
}

const scheduler = createCronScheduler();
scheduler.scheduleJob("0 9 * * 1-5", "Review open pull requests");
scheduler.tick(new Date("2026-06-03T09:00:00"));
scheduler.consumeQueue();

export {};
