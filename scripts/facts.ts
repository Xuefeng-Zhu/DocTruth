import { runDrift } from "../src/lib/drift";
runDrift(process.argv[2] || "sample").then(r => {
  console.log("credits", r.credits, "compare", r.compareCredits, "extract", r.facts.credits, r.ms, "ms", "facts", r.facts.count);
  for (const row of r.facts.rows) console.log(row.mismatch ? (row.confirmed ? "CONFIRMED" : "MISMATCH ") : "same     ", row.key, "|", row.entries.map(e => `${e.path}: ${e.value}`).join("  ||  "));
  for (const p of r.result.pairs) for (const c of p.conflicts) console.log("CONFLICT", p.a, "|", c.a.quote.slice(0,80), "<>", p.b, "|", c.b.quote.slice(0,80));
}).catch(e => console.error(e));
