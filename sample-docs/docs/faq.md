# FAQ

## How many times is a failed job retried?

Three times. After the third retry fails, the job goes to the dead-letter queue.

## Does Tidepool work with Redis Cluster?

Yes, from version 3.2. Use hash tags in queue names (for example `{emails}`) so all keys for a queue land in the same slot.

## Can I use Tidepool in serverless functions?

You can enqueue jobs from serverless functions, but workers need a long-running process. Use a container or a VM for workers.

## Which Node.js versions are supported?

Node.js 20 and 22 are tested in CI.
