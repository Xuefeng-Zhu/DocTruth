# Installation

## Requirements

Tidepool 3.x requires **Node.js 20 or newer** and **Redis 7.0 or newer**. Node 18 reached end of life and is no longer tested.

## Install the package

```bash
npm install tidepool
# or
pnpm add tidepool
```

## Connecting to Redis

Pass a Redis URL or an ioredis instance as `connection`. If you omit it, Tidepool reads the `TIDEPOOL_REDIS_URL` environment variable, and falls back to `redis://localhost:6379`.

TLS connections use the `rediss://` scheme. Redis Cluster is supported from version 3.2.

## Verifying the install

Run `npx tidepool doctor`. It checks the Node version, connects to Redis, and prints the server version and the eviction policy. Tidepool needs the `noeviction` policy; any other policy can silently drop jobs.
