import { clocked } from "./clocked";
import { loadCorpus, prefilter } from "./corpus";
import type { AskEvent, Chunk, CompareResult, RerankResult, VerifyResult } from "./types";

const CANDIDATES = 40;
const MAX_SOURCES = 8;
const VERIFY_THRESHOLD = 0.6;

const RERANK_INSTRUCTIONS =
  "Passages come from one software project's documentation. 'use' only when the passage itself states the answer for this user. " +
  "A passage about a different version, platform or feature than the user asked about is a different case.";

const VERIFY_INSTRUCTIONS =
  "The sources are documentation passages for one software project. Judge each claim only against these passages. " +
  "Exact values matter: a different version number, default value, port, count, flag name or command is a contradiction, not support. " +
  "A claim the passages do not state is not_stated even if it sounds plausible. " +
  "Each source begins with a 'Page:' line naming the documentation page it comes from. A claim that a named page states something is supported when that page's passage states it. " +
  "A claim that the documentation disagrees or is inconsistent is supported when two passages give different values for the same thing.";

const COMPARE_INSTRUCTIONS =
  "These are passages from different pages of the same project's documentation. A conflict is two passages giving different values or behavior " +
  "for the same setting, default, requirement, version, port, limit, command or procedure, in the same scope. Different topics are unrelated, not conflicts. " +
  "A page that adds detail to another is overlapping, not conflicting.";

export type AskInput = {
  source: string;
  question: string;
  answer?: string; // optional answer from another AI to audit
  context?: string; // optional user context for Rerank (version, platform, role)
};

type Emit = (e: AskEvent) => void;

export async function runAsk(input: AskInput, emit: Emit) {
  const t0 = Date.now();
  let credits = 0;
  const track = <T,>(c: { credits: number; data: T }) => {
    credits += c.credits;
    return c.data;
  };

  // 1. Load docs and pick a bounded candidate set.
  emit({ type: "stage", stage: "retrieve", status: "running" });
  const corpus = await loadCorpus(input.source);
  const cands = prefilter(corpus.chunks, input.question + " " + (input.answer ?? ""), CANDIDATES);
  emit({ type: "candidates", count: cands.length, total: corpus.chunks.length });
  emit({ type: "stage", stage: "retrieve", status: "done", detail: `${cands.length} of ${corpus.chunks.length} sections from ${corpus.docs.length} pages` });

  // 2. Rerank: use / expand / skip for every candidate.
  emit({ type: "stage", stage: "rerank", status: "running" });
  const rerank = async (chunks: Chunk[]) => {
    const r = await clocked<{ results: RerankResult[] }>("rerank", {
      query: input.question,
      documents: chunks.map((c) => ({ id: c.id, title: `${c.path} › ${c.heading}`, text: c.text })),
      instructions: RERANK_INSTRUCTIONS,
      ...(input.context?.trim() ? { context: input.context.trim() } : {}),
    });
    const data = track(r);
    return data.results.map((x) => ({ ...x, chunk: chunks[x.index] }));
  };
  let ranked = await rerank(cands);
  emit({ type: "rerank", round: 1, results: ranked });

  // 2b. "expand" means right page, answer is nearby: pull neighbouring sections and rerank them.
  const expandFrom = ranked.filter((r) => r.action === "expand").slice(0, 4);
  if (expandFrom.length) {
    const seen = new Set(ranked.map((r) => r.chunk.id));
    const neighbours: Chunk[] = [];
    for (const r of expandFrom) {
      for (const c of corpus.chunks) {
        if (c.path === r.chunk.path && Math.abs(c.seq - r.chunk.seq) <= 2 && !seen.has(c.id)) {
          seen.add(c.id);
          neighbours.push(c);
        }
      }
    }
    if (neighbours.length) {
      const round2 = await rerank(neighbours);
      emit({ type: "rerank", round: 2, results: round2 });
      ranked = [...ranked, ...round2];
    }
  }
  // Sources: every "use", then the strongest "expand" sections (right page, answer around them).
  const useR = ranked.filter((r) => r.action === "use").sort((a, b) => b.relevance_score - a.relevance_score);
  const expR = ranked
    .filter((r) => r.action === "expand" && r.document_score >= 0.5)
    .sort((a, b) => b.document_score - a.document_score);
  const used = useR.length ? [...useR, ...expR].slice(0, MAX_SOURCES).map((r) => r.chunk) : [];
  emit({
    type: "stage",
    stage: "rerank",
    status: "done",
    detail: `${useR.length} use · ${ranked.filter((r) => r.action === "expand").length} expand · ${ranked.filter((r) => r.action === "skip").length} skip`,
  });

  let sources = used;
  if (!sources.length) {
    if (!input.answer?.trim()) {
      emit({ type: "uncovered", message: "The docs don't answer this question. DocTruth won't guess." });
      for (const s of ["compare", "draft", "verify"]) emit({ type: "stage", stage: s, status: "skipped" });
      emit({ type: "done", credits, ms: Date.now() - t0 });
      return;
    }
    // Auditing a pasted answer: check it against the closest pages anyway.
    sources = [...ranked].sort((a, b) => b.document_score - a.document_score).slice(0, 5).map((r) => r.chunk);
    emit({ type: "uncovered", message: "No section answers this directly, so the answer is checked against the closest sections." });
  }
  emit({ type: "sources", chunks: sources });

  // 3. Compare: do the sources disagree with each other?
  let conflictNote = "";
  const distinctPages = new Set(sources.map((s) => s.path));
  if (sources.length >= 2 && distinctPages.size >= 2) {
    emit({ type: "stage", stage: "compare", status: "running" });
    const cmp = track(
      await clocked<CompareResult>("compare", {
        documents: sources.map((s) => ({ id: s.id, text: s.text })),
        instructions: COMPARE_INSTRUCTIONS,
        evidence: "flagged",
      })
    );
    emit({ type: "conflicts", result: cmp, chunks: sources });
    const conflicts = cmp.pairs.flatMap((p) => p.conflicts);
    emit({ type: "stage", stage: "compare", status: "done", detail: conflicts.length ? `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} between sources` : "sources agree" });
    if (conflicts.length) {
      conflictNote =
        "The documentation contradicts itself on this topic: " +
        conflicts
          .slice(0, 4)
          .map((c) => `"${c.a.quote}" (${pathOf(c.a.document, sources)}) vs "${c.b.quote}" (${pathOf(c.b.document, sources)})`)
          .join("; ") +
        ". Do not pick one silently. Write it as 'page A says X, while page B says Y', naming each page. Do not add a separate sentence saying the documentation disagrees.";
    }
  } else {
    emit({ type: "stage", stage: "compare", status: "skipped", detail: "one page only" });
  }

  // 4. Answer: audit a pasted answer, or draft one from the sources with Fill.
  let answer = input.answer?.trim() ?? "";
  const which: "draft" | "pasted" = answer ? "pasted" : "draft";
  const passageText = sources.map((s, i) => `[Source ${i + 1}: ${s.path} › ${s.heading}]\n${s.text}`).join("\n\n");
  if (!answer) {
    emit({ type: "stage", stage: "draft", status: "running" });
    answer = await draft(passageText, input.question, conflictNote, "", (c) => (credits += c));
    emit({ type: "answer", which, text: answer });
    emit({ type: "stage", stage: "draft", status: "done" });
  } else {
    emit({ type: "answer", which, text: answer });
    emit({ type: "stage", stage: "draft", status: "skipped", detail: "auditing your answer" });
  }

  // 5. Verify claim by claim.
  emit({ type: "stage", stage: "verify", status: "running" });
  const verify = (ans: string) => verifyAnswer(ans, sources, input.question, (n) => (credits += n));
  const v1 = await verify(answer);
  emit({ type: "verify", which, result: v1 });
  const bad = unsupported(v1);
  emit({ type: "stage", stage: "verify", status: "done", detail: `${pct(v1.grounded)} grounded · ${bad.length} unsupported claim${bad.length === 1 ? "" : "s"}` });

  // 6. Repair: rewrite without the unsupported claims, then verify again.
  if (bad.length) {
    emit({ type: "stage", stage: "repair", status: "running" });
    const fixNote =
      "A previous answer made these claims that the passages do not support. Remove them. Where a passage gives the correct value, state that value instead; otherwise simply leave the point out:\n" +
      bad.map((c) => `- ${c.claim} (${c.verdict}${c.evidence ? `; passage says: "${c.evidence.quote}"` : ""})`).join("\n");
    const repaired = await draft(passageText, input.question, conflictNote, fixNote, (c) => (credits += c));
    emit({ type: "answer", which: "repaired", text: repaired });
    const v2 = await verify(repaired);
    emit({ type: "verify", which: "repaired", result: v2 });
    const bad2 = unsupported(v2).length;
    const better = bad2 < bad.length || (bad2 === bad.length && v2.grounded > v1.grounded);
    emit({ type: "repair_result", kept: better ? "repaired" : which });
    emit({ type: "stage", stage: "repair", status: "done", detail: better ? `${pct(v1.grounded)} → ${pct(v2.grounded)} grounded` : `rewrite scored ${pct(v2.grounded)}, kept the original` });
  } else {
    emit({ type: "stage", stage: "repair", status: "skipped", detail: "nothing to fix" });
  }

  emit({ type: "done", credits, ms: Date.now() - t0 });
}

async function draft(passages: string, question: string, conflictNote: string, fixNote: string, addCredits: (n: number) => void) {
  const r = await clocked<{ fields: { answer: { value: string } } }>("fill", {
    text: passages,
    instructions:
      "You answer developer questions using only the documentation passages provided. Be concise and concrete: name exact commands, options, defaults and versions as written. " +
      "Never add facts that are not in the passages. If the passages do not answer part of the question, say so. " +
      (conflictNote ? "\n" + conflictNote : "") +
      (fixNote ? "\n" + fixNote : ""),
    fields: {
      answer: {
        type: "generate",
        format: "text",
        max_tokens: 320,
        description: `Answer this question in at most 4 sentences, using only the passages: ${question}`,
      },
    },
  });
  addCredits(r.credits);
  return String(r.data.fields?.answer?.value ?? "").trim();
}

/**
 * Verify an answer claim by claim. A sentence that attributes something to one page
 * ("README.md says ...") is checked against that page alone, so an honest report of
 * two pages disagreeing is not marked as contradicted by the other page.
 */
export async function verifyAnswer(answer: string, sources: Chunk[], question: string, addCredits: (n: number) => void): Promise<VerifyResult> {
  const clauses = splitClauses(answer);
  const paths = [...new Set(sources.map((s) => s.path))];
  const groups = new Map<string, { idx: number; text: string }[]>();
  clauses.forEach((text, idx) => {
    const named = paths.filter((p) => text.includes(p) || new RegExp(`\\b${esc(p.split("/").pop()!)}\\b`).test(text));
    const key = named.length === 1 ? named[0] : "*";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ idx, text });
  });
  const keys = [...groups.keys()];
  const qKey = keys.length === 1 ? keys[0] : "";
  // With claims split across pages, ask Decide whether the whole answer addresses the question.
  const relevance =
    qKey === ""
      ? clocked<{ answers: Record<string, { noul: number }> }>("decide", {
          state: `Question: ${question}\n\nAnswer: ${answer}`,
          questions: {
            answers_question: {
              type: "noul",
              instructions: "Does the answer directly address what the question asks (even if it reports that sources disagree)?",
            },
          },
        }).then((r) => {
          addCredits(r.credits);
          return r.data.answers?.answers_question?.noul;
        })
      : Promise.resolve(undefined);
  const results = await Promise.all(
    keys.map(async (key) => {
      const docs = key === "*" ? sources : sources.filter((s) => s.path === key);
      const r = await clocked<VerifyResult>("grounding", {
        documents: docs.map((s) => ({ id: s.id, text: `Page: ${s.path} › ${s.heading}\n${s.text}` })),
        answer: groups.get(key)!.map((g) => g.text).join(" "),
        claims: groups.get(key)!.map((g) => g.text).slice(0, 30),
        ...(key === qKey ? { question } : {}),
        evidence: "all",
        threshold: VERIFY_THRESHOLD,
        instructions: VERIFY_INSTRUCTIONS,
      });
      addCredits(r.credits);
      return { key, data: r.data };
    })
  );
  const claims: VerifyResult["claims"] = new Array(clauses.length);
  let answers_question: number | undefined = await relevance;
  for (const { key, data } of results) {
    groups.get(key)!.forEach((g, i) => {
      const c = data.claims[i];
      if (c) claims[g.idx] = { ...c, claim: g.text, scope: key === "*" ? undefined : key } as VerifyResult["claims"][number];
    });
    if (key === qKey) answers_question = data.answers_question;
  }
  const list = claims.filter(Boolean);
  const counted = list.filter((c) => c.counted);
  const total = counted.reduce((a, c) => a + c.claim.length, 0) || 1;
  const grounded = counted.reduce((a, c) => a + c.claim.length * (c.verdict === "supported" ? 1 : c.supported), 0) / total;
  return {
    grounded,
    ungrounded: 1 - grounded,
    verdict: grounded >= VERIFY_THRESHOLD ? "grounded" : "ungrounded",
    threshold: VERIFY_THRESHOLD,
    claims: list,
    answers_question,
  };
}

function splitClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z`"'(\[]|docs\/)|;\s+|,?\s+while\s+(?=\S+\.mdx?\b)/)
    .map((x) => x.trim())
    .filter((x) => x.length > 3);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sentences that only say the docs are silent are honesty, not claims to penalise.
const GAP = /\b(do(es)?n['’]?t|do(es)? not|never)\s+(state|say|mention|cover|specify|document|address)/i;
export const unsupported = (v: VerifyResult) => v.claims.filter((c) => c.counted && c.verdict !== "supported" && !GAP.test(c.claim));

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pathOf = (id: string, chunks: Chunk[]) => chunks.find((c) => c.id === id)?.path ?? id;
