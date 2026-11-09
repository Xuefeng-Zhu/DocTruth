# Retries and failures

## Default retry policy

When a handler throws, Tidepool retries the job. By default a job gets **5 attempts in total** (the first try plus 4 retries), with exponential backoff starting at 1 second and doubling each time, capped at 1 hour.

Set your own policy per job:

```js
await queue.add("charge", data, { attempts: 8, backoff: { type: "exponential", delay: 2000 } });
```

## Dead-letter queue

After the last attempt fails, the job moves to the `<queue>:dead` list and stays there for 14 days. You can retry dead jobs from the dashboard or with `queue.retryDead()`.

## Non-retryable errors

Throw `new UnrecoverableError(message)` to fail a job immediately without retrying. Validation errors are a good fit.
