import { clocked } from "./clocked";
import { loadCorpus } from "./corpus";
import type { CompareResult } from "./types";

const PER_DOC = 16_000;
const TOTAL = 140_000;
const TOO_FEW_PAGES = "Pick at least two pages to compare.";

const INSTRUCTIONS =
  "These are pages of one software project's documentation. Report a conflict only when two pages give different values or behavior for the same " +
  "setting, default, requirement, version, port, limit, command or procedure in the same scope. A page that adds detail to another is overlapping, not conflicting. " +
  "Repeated explanations of the same fact are duplicates.";

export async function runDrift(source: string, paths?: string[]) {
  if (paths && new Set(paths).size < 2) throw new Error(TOO_FEW_PAGES);
  const corpus = await loadCorpus(source);
  let docs = paths === undefined ? corpus.docs : corpus.docs.filter((d) => paths.includes(d.path));
  const picked: typeof docs = [];
  let total = 0;
  for (const d of docs) {
    const len = Math.min(d.text.length, PER_DOC);
    if (picked.length >= 8 || total + len > TOTAL) break;
    picked.push(d);
    total += len;
  }
  docs = picked;
  if (docs.length < 2) throw new Error(TOO_FEW_PAGES);
  const r = await clocked<CompareResult>("compare", {
    documents: docs.map((d) => ({ id: d.path, text: d.text.slice(0, PER_DOC) })),
    instructions: INSTRUCTIONS,
    evidence: "flagged",
  });
  return {
    source: corpus.source,
    docs: docs.map((d) => ({ path: d.path, url: d.url, text: d.text.slice(0, PER_DOC) })),
    allPages: corpus.docs.map((d) => d.path),
    result: r.data,
    credits: r.credits,
    ms: r.ms,
  };
}
