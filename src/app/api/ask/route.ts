import { runAsk } from "@/lib/pipeline";
import { rateLimit } from "@/lib/ratelimit";
import type { AskEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").trim().slice(0, 1000);
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runAsk(
          {
            source: String(body.source || "sample"),
            question,
            answer: body.answer ? String(body.answer).slice(0, 8000) : undefined,
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
