"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AskEvent, Chunk, CompareFinding, CompareResult, RerankResult, VerifyClaim, VerifyResult } from "@/lib/types";

const SAMPLE_REPO = process.env.NEXT_PUBLIC_SAMPLE_REPO_URL || "https://github.com/Xuefeng-Zhu/doctruth/blob/main/sample-docs";

const SAMPLE_QUESTIONS = [
  "How many times is a failed job retried?",
  "What port does the dashboard run on, and can it delete jobs?",
  "Which Node.js version do I need?",
  "Does Tidepool support Kafka as a backend?",
];
const SAMPLE_AUDIT = {
  q: "What port does the dashboard run on, and can it delete jobs?",
  a: "The Tidepool dashboard runs on port 4000 and is read-only, so it cannot delete jobs. You can turn on single sign-on with the --sso flag.",
};

const STAGES: { key: string; label: string; api: string }[] = [
  { key: "retrieve", label: "Retrieve", api: "local BM25" },
  { key: "rerank", label: "Rerank", api: "Clocked /rerank" },
  { key: "compare", label: "Compare sources", api: "Clocked /compare" },
  { key: "draft", label: "Draft", api: "Clocked /fill" },
  { key: "verify", label: "Verify", api: "/grounding + /decide" },
  { key: "repair", label: "Repair", api: "/fill + /grounding" },
];

type StageState = { status: "idle" | "running" | "done" | "skipped" | "error"; detail?: string };
type Ranked = RerankResult & { chunk: Chunk; round: number };

type PageInfo = { path: string; url: string; chars: number };

function pageUrl(source: string, path: string, line?: number, pages?: PageInfo[]) {
  const base = source === "sample" ? `${SAMPLE_REPO}/${path}` : pages?.find((p) => p.path === path)?.url || "#";
  return line ? `${base}#L${line}` : base;
}

export default function Home() {
  const [mode, setMode] = useState<"sample" | "repo">("sample");
  const [repo, setRepo] = useState("");
  const [loaded, setLoaded] = useState<{ source: string; label: string; pages: PageInfo[]; sections: number } | null>({
    source: "sample",
    label: "Tidepool (sample project)",
    pages: [],
    sections: 0,
  });
  const [loadingCorpus, setLoadingCorpus] = useState(false);
  const [corpusErr, setCorpusErr] = useState("");
  const [tab, setTab] = useState<"ask" | "drift">("ask");
  const corpusRequest = useRef<AbortController | null>(null);

  async function loadSource(src: string) {
    corpusRequest.current?.abort();
    const controller = new AbortController();
    corpusRequest.current = controller;
    setLoadingCorpus(true);
    setCorpusErr("");
    try {
      const r = await fetch("/api/corpus", { method: "POST", body: JSON.stringify({ source: src }), signal: controller.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (!controller.signal.aborted) {
        setLoaded({ source: j.source === "sample" ? "sample" : src, label: j.label, pages: j.pages, sections: j.sections });
      }
    } catch (e) {
      if (!controller.signal.aborted) setCorpusErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoadingCorpus(false);
    }
  }

  const source = loaded?.source || "sample";
  useEffect(() => {
    loadSource("sample");
    return () => corpusRequest.current?.abort();
  }, []);

  return (
    <main className="wrap">
      <header className="hero">
        <div className="brand">
          <span className="logo">◆</span> DocTruth
        </div>
        <h1>
          Docs answers that <em>show their receipts.</em>
        </h1>
        <p className="sub">
          Ask a question about any public GitHub project. DocTruth ranks the docs with Clocked Rerank, checks the sources against each other with
          Compare, and verifies every claim with Verify, so a made-up flag or a stale default never reaches your users. Paste an answer from any
          other AI to audit it.
        </p>
      </header>

      <section className="card source">
        <div className="seg">
          <button className={mode === "sample" ? "on" : ""} onClick={() => { setMode("sample"); loadSource("sample"); }}>
            Sample project
          </button>
          <button className={mode === "repo" ? "on" : ""} onClick={() => setMode("repo")}>
            GitHub repo
          </button>
        </div>
        {mode === "repo" ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (repo.trim()) loadSource(repo.trim());
            }}
          >
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo, owner/repo/docs, or a github.com URL" />
            <button className="primary" disabled={loadingCorpus}>{loadingCorpus ? "Loading…" : "Load docs"}</button>
          </form>
        ) : (
          <p className="muted">
            <b>Tidepool</b> is a fictional job-queue library whose seven docs pages quietly disagree with each other, the way real docs drift.
          </p>
        )}
        {corpusErr && <p className="err">{corpusErr}</p>}
        {loaded && loaded.pages.length > 0 && (
          <p className="muted small">
            Loaded <b>{loaded.label}</b>: {loaded.pages.length} pages, {loaded.sections} sections.
          </p>
        )}
      </section>

      <nav className="tabs">
        <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>Ask & verify</button>
        <button className={tab === "drift" ? "on" : ""} onClick={() => setTab("drift")}>Docs drift scan</button>
      </nav>

      {tab === "ask" ? <Ask key={source} source={source} pages={loaded?.pages} /> : <Drift key={source} source={source} />}

      <footer className="foot">
        Built for the Clocked Build Challenge 2026 · Uses Clocked <code>/rerank</code>, <code>/compare</code>, <code>/extract</code>, <code>/grounding</code>, <code>/decide</code> and <code>/fill</code> ·{" "}
        <a href="https://github.com/Xuefeng-Zhu/DocTruth">Source on GitHub</a>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ Ask */

function Ask({ source, pages }: { source: string; pages?: PageInfo[] }) {
  const [question, setQuestion] = useState("");
  const [audit, setAudit] = useState(false);
  const [pasted, setPasted] = useState("");
  const [context, setContext] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<string, StageState>>({});
  const [ranked, setRanked] = useState<Ranked[]>([]);
  const [sources, setSources] = useState<Chunk[]>([]);
  const [conflicts, setConflicts] = useState<CompareResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [verifies, setVerifies] = useState<Record<string, VerifyResult>>({});
  const [kept, setKept] = useState<string>("");
  const [uncovered, setUncovered] = useState("");
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<{ credits: number; ms: number } | null>(null);
  const [selected, setSelected] = useState<VerifyClaim | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setStages({});
    setRanked([]);
    setSources([]);
    setConflicts(null);
    setAnswers({});
    setVerifies({});
    setKept("");
    setUncovered("");
    setError("");
    setUsage(null);
    setSelected(null);
  }

  async function run(q: string, a?: string) {
    if (!q.trim() || (a !== undefined && !a.trim())) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    reset();
    setRunning(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        body: JSON.stringify({ source, question: q, answer: a || undefined, context: context || undefined }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) handle(JSON.parse(line) as AskEvent);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function handle(e: AskEvent) {
    switch (e.type) {
      case "stage":
        setStages((s) => ({ ...s, [e.stage]: { status: e.status, detail: e.detail } }));
        break;
      case "rerank":
        setRanked((r) => [...r, ...e.results.map((x) => ({ ...x, round: e.round }))]);
        break;
      case "sources":
        setSources(e.chunks);
        break;
      case "conflicts":
        setConflicts(e.result);
        break;
      case "answer":
        setAnswers((a) => ({ ...a, [e.which]: e.text }));
        break;
      case "verify":
        setVerifies((v) => ({ ...v, [e.which]: e.result }));
        break;
      case "repair_result":
        setKept(e.kept);
        break;
      case "uncovered":
        setUncovered(e.message);
        break;
      case "error":
        setError(e.message);
        break;
      case "done":
        setUsage({ credits: e.credits, ms: e.ms });
        break;
    }
  }

  const first = answers.pasted !== undefined ? "pasted" : "draft";
  const finalKey = kept || (verifies.repaired ? "repaired" : first);
  const chunkById = useMemo(() => new Map([...ranked.map((r) => r.chunk), ...sources].map((c) => [c.id, c])), [ranked, sources]);
  const conflictList = useMemo(() => (conflicts ? dedupeFindings(conflicts.pairs.flatMap((p) => p.conflicts)) : []), [conflicts]);

  return (
    <section>
      <div className="card ask">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(question, audit ? pasted : undefined);
          }}
        >
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the docs a question…" />
          <button className="primary" disabled={running || !question.trim() || (audit && !pasted.trim())}>
            {running ? "Checking…" : audit ? "Audit answer" : "Ask"}
          </button>
        </form>
        {source === "sample" && (
          <div className="chips">
            {SAMPLE_QUESTIONS.map((q) => (
              <button key={q} onClick={() => { setQuestion(q); setAudit(false); run(q); }} disabled={running}>
                {q}
              </button>
            ))}
            <button
              className="chip-audit"
              disabled={running}
              onClick={() => {
                setQuestion(SAMPLE_AUDIT.q);
                setAudit(true);
                setPasted(SAMPLE_AUDIT.a);
                run(SAMPLE_AUDIT.q, SAMPLE_AUDIT.a);
              }}
            >
              Audit a chatbot&apos;s answer →
            </button>
          </div>
        )}
        <div className="opts">
          <label className="check">
            <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} /> Audit an answer from another AI instead of drafting one
          </label>
          {audit && (
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} placeholder="Paste the answer ChatGPT, Copilot or your support bot gave…" />
          )}
          <input
            className="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Optional context for ranking, e.g. “version 3.x, deploying on Kubernetes”"
          />
        </div>
      </div>

      {Object.keys(stages).length > 0 && (
        <div className="pipeline">
          {STAGES.map((s, i) => {
            const st = stages[s.key]?.status || "idle";
            return (
              <div key={s.key} className={`step ${st}`}>
                <div className="dot">{st === "done" ? "✓" : st === "skipped" ? "–" : st === "running" ? <span className="spin" /> : i + 1}</div>
                <div>
                  <div className="step-label">{s.label}</div>
                  <div className="step-api">{s.api}</div>
                  {stages[s.key]?.detail && <div className="step-detail">{stages[s.key]!.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="card err">{error}</div>}
      {uncovered && <div className="card notice">{uncovered}</div>}

      {conflictList.length > 0 && (
        <div className="card conflict">
          <h3>⚠ Your docs disagree on this</h3>
          <p className="muted small">Clocked Compare found these contradictions between the sections that answer the question. DocTruth tells the reader instead of silently picking one.</p>
          {conflictList.map((c, i) => (
            <ConflictRow key={i} c={c} label={(id) => chunkById.get(id)?.path || id} link={(id, off) => {
              const ch = chunkById.get(id);
              return ch ? pageUrl(source, ch.path, lineOf(ch, off), pages) : "#";
            }} />
          ))}
        </div>
      )}

      {answers[first] !== undefined && (
        <div className="answers">
          <AnswerCard
            title={first === "pasted" ? "The answer you pasted" : "Draft answer"}
            text={answers[first]}
            v={verifies[first]}
            dim={finalKey !== first}
            onPick={setSelected}
            selected={selected}
          />
          {answers.repaired !== undefined && (
            <AnswerCard
              title={finalKey === "repaired" ? "Repaired answer ✓" : "Attempted repair (not kept)"}
              text={answers.repaired}
              v={verifies.repaired}
              dim={finalKey !== "repaired"}
              onPick={setSelected}
              selected={selected}
            />
          )}
        </div>
      )}

      {selected && (
        <div className="card evidence">
          <div className="ev-head">
            <span className={`badge ${selected.verdict}`}>{verdictLabel(selected.verdict)}</span>
            <span className="muted small">
              supported {pct(selected.supported)} · contradicted {pct(selected.contradicted)} · not stated {pct(selected.not_stated)}
              {selected.scope ? ` · checked against ${selected.scope} only` : ""}
            </span>
            <button className="x" onClick={() => setSelected(null)}>×</button>
          </div>
          <p className="claim">“{selected.claim}”</p>
          {selected.evidence ? (
            (() => {
              const ch = chunkById.get(selected.evidence!.document);
              const off = Math.max(0, selected.evidence!.start - prefixLen(ch));
              return (
                <blockquote>
                  {clean(selected.evidence!.quote)}
                  {ch && (
                    <a href={pageUrl(source, ch.path, lineOf(ch, off), pages)} target="_blank" rel="noreferrer">
                      {ch.path} · line {lineOf(ch, off)} ↗
                    </a>
                  )}
                </blockquote>
              );
            })()
          ) : (
            <p className="muted small">
              {selected.verdict === "contradicted"
                ? "The docs say otherwise. The sections Rerank picked are listed below."
                : "No passage in the docs states this."}
            </p>
          )}
        </div>
      )}

      {ranked.length > 0 && <SourcesTable ranked={ranked} source={source} pages={pages} usedIds={new Set(sources.map((s) => s.id))} />}

      {usage && (
        <p className="muted small center">
          {usage.credits} Clocked credits · {(usage.ms / 1000).toFixed(1)}s end to end
        </p>
      )}
    </section>
  );
}

function AnswerCard({
  title,
  text,
  v,
  dim,
  onPick,
  selected,
}: {
  title: string;
  text: string;
  v?: VerifyResult;
  dim?: boolean;
  onPick: (c: VerifyClaim) => void;
  selected: VerifyClaim | null;
}) {
  const bad = v ? v.claims.filter((c) => c.counted && c.verdict !== "supported").length : 0;
  return (
    <div className={`card answer ${dim ? "dim" : ""}`}>
      <div className="ans-head">
        <h3>{title}</h3>
        {v && <Meter value={v.grounded} />}
      </div>
      {v ? (
        <p className="ans-text">
          {v.claims.map((c, i) => (
            <span
              key={i}
              className={`cl ${c.counted ? c.verdict : "not_a_claim"} ${selected?.claim === c.claim ? "sel" : ""}`}
              onClick={() => onPick(c)}
              title="Show evidence"
            >
              {c.claim}{" "}
            </span>
          ))}
        </p>
      ) : (
        <p className="ans-text pending">{text}</p>
      )}
      {v && (
        <div className="ans-foot small">
          <span>{v.claims.length} claims · {bad === 0 ? "all supported by the docs" : `${bad} not supported`}</span>
          {typeof v.answers_question === "number" && <span>answers the question: {pct(v.answers_question)}</span>}
          <span className="legend">
            <i className="cl supported">supported</i> <i className="cl contradicted">contradicted</i> <i className="cl not_stated">not in docs</i>
          </span>
        </div>
      )}
    </div>
  );
}

function SourcesTable({ ranked, source, pages, usedIds }: { ranked: Ranked[]; source: string; pages?: PageInfo[]; usedIds: Set<string> }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...ranked].sort((a, b) => order(a) - order(b) || b.relevance_score - a.relevance_score);
  const shown = showAll ? sorted : sorted.filter((r) => r.action !== "skip").concat(sorted.filter((r) => r.action === "skip").slice(0, 3));
  return (
    <div className="card">
      <div className="ans-head">
        <h3>How Rerank read the docs</h3>
        <span className="muted small">
          {ranked.filter((r) => r.action === "use").length} use · {ranked.filter((r) => r.action === "expand").length} expand ·{" "}
          {ranked.filter((r) => r.action === "skip").length} skip
        </span>
      </div>
      <div className="src-scroll" role="region" aria-label="Ranked documentation sections" tabIndex={0}>
        <table className="src">
          <thead>
            <tr>
              <th>Section</th>
              <th>Decision</th>
              <th>Answers it</th>
              <th>Right page</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.chunk.id + r.round} className={usedIds.has(r.chunk.id) ? "used" : ""}>
                <td>
                  <a href={pageUrl(source, r.chunk.path, r.chunk.line, pages)} target="_blank" rel="noreferrer">
                    {r.chunk.path}
                  </a>
                  <div className="muted small">{r.chunk.heading}{r.round === 2 ? " · pulled in by expand" : ""}</div>
                </td>
                <td>
                  <span className={`badge ${r.action}`}>{r.action}</span>
                  {r.reason && <span className="muted small"> {r.reason.replace("_", " ")}</span>}
                </td>
                <td><Bar v={r.relevance_score} /></td>
                <td><Bar v={r.document_score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown.length && (
        <button className="link" onClick={() => setShowAll(true)}>Show all {sorted.length} sections</button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Drift */

type DriftResp = {
  source: string;
  docs: { path: string; url: string; text: string }[];
  allPages: string[];
  result: CompareResult;
  facts: { rows: FactRow[]; count: number; pages: number; credits: number };
  credits: number;
  compareCredits: number;
  ms: number;
};

type FactRow = {
  key: string;
  label: string;
  entries: { path: string; setting: string; value: string; start: number; end: number; confidence: number }[];
  mismatch: boolean;
  confirmed: boolean;
};

function Drift({ source }: { source: string }) {
  const [data, setData] = useState<DriftResp | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function scan(paths?: string[]) {
    setRunning(true);
    setError("");
    try {
      const r = await fetch("/api/drift", { method: "POST", body: JSON.stringify({ source, paths }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j);
      setPicked(j.docs.map((d: { path: string }) => d.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const doc = (id: string) => data?.docs.find((d) => d.path === id);
  const link = (id: string, off: number) => {
    const d = doc(id);
    if (!d) return "#";
    const line = d.text.slice(0, off).split("\n").length;
    return source === "sample" ? `${SAMPLE_REPO}/${id}#L${line}` : `${d.url}#L${line}`;
  };
  const conflicts = data ? dedupeFindings(data.result.pairs.flatMap((p) => p.conflicts)) : [];
  const dups = data ? data.result.pairs.reduce((a, p) => a + p.duplicates.length, 0) : 0;
  const factRows = data?.facts?.rows || [];
  const extractOnly = factRows.filter((r) => r.mismatch && !r.confirmed);

  function issue() {
    const body =
      `## Documentation conflicts found by DocTruth\n\n` +
      conflicts
        .map(
          (c, i) =>
            `${i + 1}. **${c.a.document}** says: "${clean(c.a.quote)}"\n   **${c.b.document}** says: "${clean(c.b.quote)}"\n   ${link(c.a.document, c.a.start)}\n   ${link(c.b.document, c.b.start)}`
        )
        .join("\n\n") +
      (extractOnly.length
        ? `\n\n### Values that differ between pages (Clocked Extract, please review)\n\n` +
          extractOnly
            .map((r) => `- **${r.label}**: ` + r.entries.map((e) => `${e.path} says "${e.value}" (${link(e.path, e.start)})`).join("; "))
            .join("\n")
        : "") +
      `\n\nFound with Clocked Compare and Extract (${data?.credits} credits).`;
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section>
      <div className="card">
        <h3>Find where your docs contradict themselves</h3>
        <p className="muted">
          Clocked Compare reads every pair of pages and flags the values, defaults and requirements that disagree, with the passage from each side. Clocked Extract reads each page&apos;s hard facts verbatim so DocTruth can line them up side by side.
          Up to 8 pages per scan; the README and docs/ pages come first.
        </p>
        {data && (
          <div className="pagepick">
            {data.allPages.slice(0, 40).map((p) => (
              <label key={p} className="check small">
                <input
                  type="checkbox"
                  checked={picked.includes(p)}
                  onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p].slice(0, 8) : x.filter((y) => y !== p)))}
                />{" "}
                {p}
              </label>
            ))}
          </div>
        )}
        <button className="primary" disabled={running || (data !== null && picked.length < 2)} onClick={() => scan(data ? picked : undefined)}>
          {running ? "Comparing pages…" : data ? "Rescan selected pages" : "Scan docs for drift"}
        </button>
        {data && picked.length < 2 && <p className="muted small" role="status">Select at least two pages to rescan.</p>}
      </div>
      {error && <div className="card err">{error}</div>}
      {data && (
        <>
          <div className="stats">
            <div><b>{data.docs.length}</b><span>pages compared</span></div>
            <div><b>{data.result.pairs.length}</b><span>page pairs</span></div>
            <div className={conflicts.length ? "hot" : ""}><b>{conflicts.length}</b><span>conflicts</span></div>
            <div><b>{dups}</b><span>repeated passages</span></div>
            <div><b>{data.facts?.count ?? 0}</b><span>facts extracted</span></div>
            <div><b>{data.credits}</b><span>credits</span></div>
          </div>
          {conflicts.length > 0 ? (
            <div className="card conflict">
              <div className="ans-head">
                <h3>Conflicts</h3>
                <button className="link" onClick={issue}>{copied ? "Copied ✓" : "Copy as GitHub issue"}</button>
              </div>
              {conflicts.map((c, i) => (
                <ConflictRow key={i} c={c} label={(id) => id} link={link} />
              ))}
            </div>
          ) : (
            <div className="card notice">No conflicts between these pages.</div>
          )}
          {factRows.length > 0 && (
            <div className="card">
              <div className="ans-head">
                <h3>Fact sheet</h3>
                <span className="muted small">Clocked Extract · {data.facts.credits} credits</span>
              </div>
              <p className="muted small">
                Extract copied each page&apos;s defaults, versions, ports and limits word for word, with their exact position. These are the facts more than one page states.
              </p>
              <table className="facts">
                <thead>
                  <tr><th>Setting</th><th>What each page says</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {factRows.map((r) => (
                    <tr key={r.key} className={r.mismatch ? "bad" : ""}>
                      <td>{r.label}</td>
                      <td>
                        {r.entries.map((e) => (
                          <div key={e.path}>
                            <a href={link(e.path, e.start)} target="_blank" rel="noreferrer">{e.path} ↗</a> <b>{e.value}</b>
                          </div>
                        ))}
                      </td>
                      <td>
                        {!r.mismatch ? "Consistent" : r.confirmed ? "Differs · Compare agrees" : "Differs · only Extract caught it"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- shared */

function ConflictRow({ c, label, link }: { c: CompareFinding; label: (id: string) => string; link: (id: string, off: number) => string }) {
  return (
    <div className="cf">
      <div className="cf-side">
        <a href={link(c.a.document, c.a.start)} target="_blank" rel="noreferrer">{label(c.a.document)} ↗</a>
        <p>{clean(c.a.quote)}</p>
      </div>
      <div className="vs">≠</div>
      <div className="cf-side">
        <a href={link(c.b.document, c.b.start)} target="_blank" rel="noreferrer">{label(c.b.document)} ↗</a>
        <p>{clean(c.b.quote)}</p>
      </div>
      {c.kind && <div className="cf-kind">{c.kind.replace(/_/g, " ")}</div>}
    </div>
  );
}

/** Compare can return several findings for one statement; keep the tightest quote per side. */
function dedupeFindings(fs: CompareFinding[]) {
  const byA = new Map<string, CompareFinding>();
  for (const f of fs) {
    const k = `${f.a.document}|${f.b.document}|${f.a.quote}`;
    const prev = byA.get(k);
    const score = (x: CompareFinding) => (/\d/.test(clean(x.b.quote)) ? 0 : 1000) + x.b.quote.length;
    if (!prev || score(f) < score(prev)) byA.set(k, f);
  }
  const byB = new Map<string, CompareFinding>();
  for (const f of byA.values()) {
    const k = `${f.a.document}|${f.b.document}|${f.b.quote}`;
    const prev = byB.get(k);
    const score = (x: CompareFinding) => (/\d/.test(clean(x.a.quote)) ? 0 : 1000) + x.a.quote.length;
    if (!prev || score(f) < score(prev)) byB.set(k, f);
  }
  return [...byB.values()];
}

function clean(q: string) {
  return q
    .split("\n")
    .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*(```|~~~)/.test(l))
    .join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const prefixLen = (ch?: Chunk) => (ch ? `Page: ${ch.path} › ${ch.heading}\n`.length : 0);
const lineOf = (ch: Chunk, off: number) => ch.line + ch.text.slice(0, Math.max(0, off)).split("\n").length - 1;
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const order = (r: Ranked) => ({ use: 0, expand: 1, skip: 2 })[r.action];
const verdictLabel = (v: string) => ({ supported: "Supported", contradicted: "Contradicted by the docs", not_stated: "Not in the docs" } as Record<string, string>)[v] || v;

function Meter({ value }: { value: number }) {
  const v = Math.round(value * 100);
  const tone = v >= 85 ? "good" : v >= 60 ? "mid" : "bad";
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-bar"><div style={{ width: `${v}%` }} /></div>
      <span>{v}% grounded</span>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(2, Math.round(v * 100))}%` }} />
      <span>{v.toFixed(2)}</span>
    </div>
  );
}
