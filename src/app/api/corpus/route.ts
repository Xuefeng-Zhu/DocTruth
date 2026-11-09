import { loadCorpus } from "@/lib/corpus";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { source } = await req.json();
    const c = await loadCorpus(String(source || "sample"));
    return Response.json({
      source: c.source,
      label: c.label,
      pages: c.docs.map((d) => ({ path: d.path, url: d.url, chars: d.text.length })),
      sections: c.chunks.length,
      // full text only for the bundled sample, so its pages can be shown in-app
      sampleDocs: c.source === "sample" ? c.docs : undefined,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
