# Workers

A worker pulls jobs from one queue and runs your handler.

## Concurrency

`concurrency` controls how many jobs one worker process runs at the same time. The default is **10**. Raise it for I/O-bound jobs such as HTTP calls; keep it low for CPU-bound jobs, or run more worker processes instead.

```js
new Worker("emails", handler, { concurrency: 25 });
```

## Graceful shutdown

Call `await worker.close()` on SIGTERM. The worker stops taking new jobs and waits up to `shutdownTimeout` (default 30 seconds) for running jobs to finish. Jobs still running after the timeout are returned to the queue and retried.

## Rate limiting

Use `limiter: { max: 100, duration: 60_000 }` to process at most 100 jobs per minute across all workers on the queue. The limit is shared through Redis.
