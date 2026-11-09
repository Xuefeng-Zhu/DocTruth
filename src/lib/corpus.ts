import type { Chunk, Corpus, Doc } from "./types";
import { SAMPLE_DOCS } from "./sample";

const MAX_FILES = 80;
const MAX_FILE_CHARS = 60_000;
const MAX_CHUNK = 2_400;

const cache = new Map<string, { at: number; corpus: Corpus }>();
const TTL = 30 * 60_000;

/** Parse "owner/repo", "owner/repo@ref", "owner/repo/sub/dir" or a github.com URL. */
export function parseRepo(input: string) {
  let s = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  s = s.replace(/\/tree\/([^/]+)/, "@$1/").replace(/\/+$/, "");
  const m = s.match(/^([\w.-]+)\/([\w.-]+)(?:@([\w./-]+?))?(?:\/(.*))?$/);
  if (!m) throw new Error("Enter a public GitHub repo like owner/repo");
  const [, owner, repo] = m;
  let [, , , ref, sub] = m;
  if (ref && ref.includes("/")) {
    const [r, ...rest] = ref.split("/");
    ref = r;
    sub = [rest.join("/"), sub].filter(Boolean).join("/");
  }
  return { owner, repo, ref, sub: sub || "" };
}

async function gh(url: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "doctruth" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url.replace("https://api.github.com", "")}`);
  return res.json();
}

function score(path: string) {
  const p = path.toLowerCase();
  let s = 0;
  if (/^readme\.mdx?$/.test(p)) s += 100;
  if (/(^|\/)(docs?|documentation|guide|guides)\//.test(p)) s += 50;
  if (/changelog|history|code_of_conduct|license|security\.md|contributing/.test(p)) s -= 30;
  if (/(^|\/)(test|tests|__tests__|fixtures|examples?\/node_modules|node_modules|vendor|\.github)\//.test(p)) s -= 200;
  if (/i18n|translations?|\/(zh|ja|ko|es|fr|de|pt|ru)(-\w+)?\//.test(p)) s -= 80;
  s -= p.split("/").length;
  return s;
}

export async function loadRepo(input: string): Promise<Corpus> {
  const { owner, repo, ref: refIn, sub } = parseRepo(input);
  const key = `${owner}/${repo}@${refIn || ""}/${sub}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.corpus;

  const ref = refIn || (await gh(`https://api.github.com/repos/${owner}/${repo}`)).default_branch;
  const tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const files: string[] = (tree.tree as { path: string; type: string; size?: number }[])
    .filter((f) => f.type === "blob" && /\.mdx?$/i.test(f.path) && (f.size ?? 0) > 80)
    .map((f) => f.path)
    .filter((p) => !sub || p.startsWith(sub.replace(/\/$/, "") + "/") || p === sub)
    .filter((p) => score(p) > -100)
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_FILES);
  if (!files.length) throw new Error("No Markdown docs found in that repo.");

  const docs: Doc[] = [];
  await Promise.all(
    files.map(async (path) => {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { cache: "no-store" });
      if (!res.ok) return;
      const text = (await res.text()).slice(0, MAX_FILE_CHARS);
      docs.push({ path, url: `https://github.com/${owner}/${repo}/blob/${ref}/${path}`, text });
    })
  );
  docs.sort((a, b) => files.indexOf(a.path) - files.indexOf(b.path));
  const corpus: Corpus = {
    source: `${owner}/${repo}@${ref}${sub ? "/" + sub : ""}`,
    label: `${owner}/${repo}`,
    docs,
    chunks: docs.flatMap(chunkDoc),
  };
  cache.set(key, { at: Date.now(), corpus });
  return corpus;
}

export function loadSample(): Corpus {
  const docs: Doc[] = SAMPLE_DOCS.map((d) => ({ ...d, url: `#sample:${d.path}` }));
  return { source: "sample", label: "Tidepool (sample project)", docs, chunks: docs.flatMap(chunkDoc) };
}

export async function loadCorpus(source: string): Promise<Corpus> {
  return !source || source === "sample" ? loadSample() : loadRepo(source);
}

/** Split Markdown into heading-scoped sections, then cap section size at paragraph boundaries. */
export function chunkDoc(doc: Doc): Chunk[] {
  const text = doc.text.replace(/\r\n/g, "\n");
  // Strip front matter but keep offsets by blanking it.
  const lines = text.split("\n");
  const sections: { start: number; heading: string }[] = [];
  const stack: string[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      stack.length = level - 1;
      stack[level - 1] = h[2].replace(/[`*_]/g, "");
      sections.push({ start: offset, heading: stack.filter(Boolean).join(" › ") });
    }
    offset += line.length + 1;
  }
  if (!sections.length || sections[0].start > 0) sections.unshift({ start: 0, heading: "" });

  const out: Chunk[] = [];
  sections.forEach((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1].start : text.length;
    let body = text.slice(s.start, end);
    let start = s.start;
    while (body.trim().length) {
      let piece = body;
      if (piece.length > MAX_CHUNK) {
        const cut = piece.lastIndexOf("\n\n", MAX_CHUNK);
        piece = piece.slice(0, cut > MAX_CHUNK / 3 ? cut : MAX_CHUNK);
      }
      if (piece.trim().length > 40) {
        out.push({
          id: `${doc.path}#${out.length}`,
          path: doc.path,
          heading: s.heading || doc.path,
          text: piece.trim(),
          start,
          line: text.slice(0, start).split("\n").length,
          seq: out.length,
        });
      }
      start += piece.length;
      body = body.slice(piece.length);
    }
  });
  return out;
}

// ---- lexical prefilter (BM25) so Rerank reads a bounded candidate set ----
const STOP = new Set("a an and are as at be by can do does for from how i in is it of on or the to what when where which who why with you your my we our this that".split(" "));
const tok = (s: string) => s.toLowerCase().match(/[a-z0-9_.-]{2,}/g)?.filter((t) => !STOP.has(t)) ?? [];

export function prefilter(chunks: Chunk[], query: string, k: number): Chunk[] {
  if (chunks.length <= k) return chunks;
  const q = [...new Set(tok(query))];
  const docsTok = chunks.map((c) => tok(c.heading + " " + c.text));
  const N = chunks.length;
  const avg = docsTok.reduce((a, d) => a + d.length, 0) / N;
  const df = new Map<string, number>();
  for (const d of docsTok) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const scored = docsTok.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg)));
    }
    // light boost for README intro sections
    if (/^readme/i.test(chunks[i].path)) s += 0.3;
    return { i, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => chunks[x.i]);
}
