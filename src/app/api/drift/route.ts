import { runDrift } from "@/lib/drift";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;
  try {
    const { source, paths } = await req.json();
    if (paths !== undefined && (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))) {
      return Response.json({ error: "Send page paths as an array of strings." }, { status: 400 });
    }
    return Response.json(await runDrift(String(source || "sample"), paths));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
