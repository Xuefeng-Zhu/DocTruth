// Tiny in-memory limiter so a public demo can't drain the API credits.
const hits = new Map<string, number[]>();
const WINDOW = 10 * 60_000;
const MAX = Number(process.env.DOCTRUTH_RATE_LIMIT || 30);

export function rateLimit(req: Request): Response | null {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (list.length >= MAX) {
    return Response.json({ error: "Demo limit reached. Try again in a few minutes, or run DocTruth locally with your own Clocked key." }, { status: 429 });
  }
  list.push(now);
  hits.set(ip, list);
  return null;
}
