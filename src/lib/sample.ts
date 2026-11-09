// Synthetic documentation for a fictional open-source project, "Tidepool".
// It deliberately contains documentation drift (pages that disagree) so the
// demo can show DocTruth catching it. No real project or person is described.

export const SAMPLE_DOCS: { path: string; text: string }[] = [
  {
    path: "README.md",
    text: `# Tidepool

Tidepool is a small, Redis-backed background job queue for Node.js. Define a job handler, enqueue work from your web app, and run one or more workers that process jobs with retries, scheduling and rate limits.

## Requirements

- Node.js 18 or newer
- Redis 6.2 or newer

## Quick start

\`\`\`bash
npm install tidepool
\`\`\`

\`\`\`js
import { Queue, Worker } from "tidepool";

const emails = new Queue("emails", { connection: process.env.REDIS_URL });
await emails.add("welcome", { to: "ada@example.com" });

new Worker("emails", async (job) => sendEmail(job.data), { concurrency: 5 });
\`\`\`

Workers process 5 jobs at a time by default. Failed jobs are retried 3 times with exponential backoff before they move to the dead-letter queue.

## Dashboard

Run \`npx tidepool dashboard\` to open the web dashboard on port 4000. The dashboard is read-only unless you start it with \`--allow-actions\`.

## License

MIT
`,
  },
  {
    path: "docs/installation.md",
    text: `# Installation

## Requirements

Tidepool 3.x requires **Node.js 20 or newer** and **Redis 7.0 or newer**. Node 18 reached end of life and is no longer tested.

## Install the package

\`\`\`bash
npm install tidepool
# or
pnpm add tidepool
\`\`\`

## Connecting to Redis

Pass a Redis URL or an ioredis instance as \`connection\`. If you omit it, Tidepool reads the \`TIDEPOOL_REDIS_URL\` environment variable, and falls back to \`redis://localhost:6379\`.

TLS connections use the \`rediss://\` scheme. Redis Cluster is supported from version 3.2.

## Verifying the install

Run \`npx tidepool doctor\`. It checks the Node version, connects to Redis, and prints the server version and the eviction policy. Tidepool needs the \`noeviction\` policy; any other policy can silently drop jobs.
`,
  },
  {
    path: "docs/workers.md",
    text: `# Workers

A worker pulls jobs from one queue and runs your handler.

## Concurrency

\`concurrency\` controls how many jobs one worker process runs at the same time. The default is **10**. Raise it for I/O-bound jobs such as HTTP calls; keep it low for CPU-bound jobs, or run more worker processes instead.

\`\`\`js
new Worker("emails", handler, { concurrency: 25 });
\`\`\`

## Graceful shutdown

Call \`await worker.close()\` on SIGTERM. The worker stops taking new jobs and waits up to \`shutdownTimeout\` (default 30 seconds) for running jobs to finish. Jobs still running after the timeout are returned to the queue and retried.

## Rate limiting

Use \`limiter: { max: 100, duration: 60_000 }\` to process at most 100 jobs per minute across all workers on the queue. The limit is shared through Redis.
`,
  },
  {
    path: "docs/retries.md",
    text: `# Retries and failures

## Default retry policy

When a handler throws, Tidepool retries the job. By default a job gets **5 attempts in total** (the first try plus 4 retries), with exponential backoff starting at 1 second and doubling each time, capped at 1 hour.

Set your own policy per job:

\`\`\`js
await queue.add("charge", data, { attempts: 8, backoff: { type: "exponential", delay: 2000 } });
\`\`\`

## Dead-letter queue

After the last attempt fails, the job moves to the \`<queue>:dead\` list and stays there for 14 days. You can retry dead jobs from the dashboard or with \`queue.retryDead()\`.

## Non-retryable errors

Throw \`new UnrecoverableError(message)\` to fail a job immediately without retrying. Validation errors are a good fit.
`,
  },
  {
    path: "docs/scheduling.md",
    text: `# Scheduling jobs

## Delayed jobs

\`queue.add(name, data, { delay: 60_000 })\` runs the job no earlier than one minute from now.

## Repeating jobs

Use a cron expression with \`repeat\`:

\`\`\`js
await queue.add("digest", {}, { repeat: { cron: "0 8 * * *", tz: "America/Los_Angeles" } });
\`\`\`

Cron schedules use UTC unless you pass \`tz\`. Removing a repeating job requires the same \`repeat\` options you created it with, or its \`jobId\`.

## Priorities

Jobs accept \`priority\` from 1 (highest) to 10 (lowest). The default priority is 5. Prioritized jobs are slower to insert, so only use priority when order matters.
`,
  },
  {
    path: "docs/dashboard.md",
    text: `# Dashboard

Start the dashboard with \`npx tidepool dashboard\`. It listens on port **3000** by default; change it with \`--port\`.

## Permissions

The dashboard can pause queues, retry dead jobs and delete jobs. Protect it behind your own authentication, for example by mounting \`tidepoolDashboard()\` as Express middleware after your auth middleware.

## Metrics

The dashboard shows throughput, failure rate and queue depth for the last 24 hours. Metrics are kept in Redis and expire after 7 days.
`,
  },
  {
    path: "docs/faq.md",
    text: `# FAQ

## How many times is a failed job retried?

Three times. After the third retry fails, the job goes to the dead-letter queue.

## Does Tidepool work with Redis Cluster?

Yes, from version 3.2. Use hash tags in queue names (for example \`{emails}\`) so all keys for a queue land in the same slot.

## Can I use Tidepool in serverless functions?

You can enqueue jobs from serverless functions, but workers need a long-running process. Use a container or a VM for workers.

## Which Node.js versions are supported?

Node.js 20 and 22 are tested in CI.
`,
  },
];
