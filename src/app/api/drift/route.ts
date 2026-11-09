import { runDrift } from "@/lib/drift";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;
  try {
    const { source, paths } = await req.json();
    return Response.json(await runDrift(String(source || "sample"), Array.isArray(paths) ? paths.map(String) : undefined));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
