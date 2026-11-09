// Minimal Clocked API client (server-side only).
// Docs: https://clocked.rezolve.ai/docs
import { randomUUID } from "crypto";

const BASE = process.env.CLOCKED_BASE_URL || "https://clocked.rezolve.ai/clocked";

export type ClockedCall<T> = {
  endpoint: string;
  data: T;
  credits: number;
  ms: number;
};

export class ClockedError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function clocked<T = unknown>(
  endpoint: "rerank" | "grounding" | "compare" | "fill" | "decide" | "extract",
  body: unknown,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<ClockedCall<T>> {
  const key = process.env.CLOCKED_API_KEY;
  if (!key) throw new ClockedError(500, "CLOCKED_API_KEY is not set on the server.");
  const idem = randomUUID(); // same key for every retry of this logical request
  const retries = opts.retries ?? 3;
  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idem,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.ok) {
        const data = (await res.json()) as T;
        return {
          endpoint,
          data,
          credits: Number(res.headers.get("x-clocked-credits") || 0),
          ms: Date.now() - started,
        };
      }
      const text = await res.text();
      // 429 / 409 (in progress) / 5xx: back off and retry with the same key.
      if ([409, 429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
        let retryAsNew = false;
        try {
          retryAsNew = !!JSON.parse(text)?.retryAsNew;
        } catch {}
        if (retryAsNew) break;
        await sleep(600 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      throw new ClockedError(res.status, `Clocked /${endpoint} ${res.status}: ${text.slice(0, 400)}`);
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (e instanceof ClockedError) throw e;
      if (attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new ClockedError(503, `Clocked /${endpoint} failed`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
