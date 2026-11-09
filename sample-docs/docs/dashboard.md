# Dashboard

Start the dashboard with `npx tidepool dashboard`. It listens on port **3000** by default; change it with `--port`.

## Permissions

The dashboard can pause queues, retry dead jobs and delete jobs. Protect it behind your own authentication, for example by mounting `tidepoolDashboard()` as Express middleware after your auth middleware.

## Metrics

The dashboard shows throughput, failure rate and queue depth for the last 24 hours. Metrics are kept in Redis and expire after 7 days.
