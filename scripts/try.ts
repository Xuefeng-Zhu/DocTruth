import { runAsk } from "../src/lib/pipeline";
const q = process.argv[2] || "How many times is a failed job retried?";
const a = process.argv[3];
runAsk({ source: process.argv[4] || "sample", question: q, answer: a }, (e) => {
  if (e.type === "rerank") console.log("RERANK", e.round, e.results.map(r => `${r.chunk.id}:${r.action}${r.reason?"/"+r.reason:""}:${r.relevance_score.toFixed(2)}`).join(" | "));
  else if (e.type === "verify") console.log("VERIFY", e.which, e.result.grounded, JSON.stringify(e.result.claims.map(c => [c.claim, c.verdict, c.evidence?.quote])));
  else if (e.type === "conflicts") console.log("COMPARE", e.result.verdict, JSON.stringify(e.result.pairs.flatMap(p => p.conflicts.map(c => [c.a.document, c.a.quote, c.b.document, c.b.quote]))));
  else console.log(JSON.stringify(e).slice(0, 400));
}).catch(e => console.error("ERR", e));
