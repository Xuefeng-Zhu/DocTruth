# Tidepool

Tidepool is a small, Redis-backed background job queue for Node.js. Define a job handler, enqueue work from your web app, and run one or more workers that process jobs with retries, scheduling and rate limits.

## Requirements

- Node.js 18 or newer
- Redis 6.2 or newer

## Quick start

```bash
npm install tidepool
```

```js
import { Queue, Worker } from "tidepool";

const emails = new Queue("emails", { connection: process.env.REDIS_URL });
await emails.add("welcome", { to: "ada@example.com" });

new Worker("emails", async (job) => sendEmail(job.data), { concurrency: 5 });
```

Workers process 5 jobs at a time by default. Failed jobs are retried 3 times with exponential backoff before they move to the dead-letter queue.

## Dashboard

Run `npx tidepool dashboard` to open the web dashboard on port 4000. The dashboard is read-only unless you start it with `--allow-actions`.

## License

MIT
