# Scheduling jobs

## Delayed jobs

`queue.add(name, data, { delay: 60_000 })` runs the job no earlier than one minute from now.

## Repeating jobs

Use a cron expression with `repeat`:

```js
await queue.add("digest", {}, { repeat: { cron: "0 8 * * *", tz: "America/Los_Angeles" } });
```

Cron schedules use UTC unless you pass `tz`. Removing a repeating job requires the same `repeat` options you created it with, or its `jobId`.

## Priorities

Jobs accept `priority` from 1 (highest) to 10 (lowest). The default priority is 5. Prioritized jobs are slower to insert, so only use priority when order matters.
