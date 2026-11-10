import { runAsk } from "@/lib/pipeline";
import { rateLimit } from "@/lib/ratelimit";
import type { AskEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Send a JSON object." }, { status: 400 });
  }
  const question = String(body.question || "").trim().slice(0, 1000);
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });
  const answer = typeof body.answer === "string" ? body.answer.trim() : undefined;
  if (body.answer !== undefined && !answer) {
    return Response.json({ error: "Paste an answer to audit." }, { status: 400 });
  }
  if (answer && answer.length > 8000) {
    return Response.json({ error: "Pasted answers must be 8,000 characters or fewer." }, { status: 400 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runAsk(
          {
            source: String(body.source || "sample"),
            question,
            answer,
            context: body.context ? String(body.context).slice(0, 2000) : undefined,
          },
          emit
        );
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
