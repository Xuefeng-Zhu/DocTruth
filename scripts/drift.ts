import { runDrift } from "../src/lib/drift";
runDrift(process.argv[2] || "sample").then(r => {
  console.log(r.credits, r.ms, r.result.verdict, r.docs.map(d=>d.path));
  for (const p of r.result.pairs) for (const c of p.conflicts) console.log("CONFLICT", p.a, "|", c.a.quote, "<>", p.b, "|", c.b.quote, c.kind);
  console.log("dups", r.result.pairs.reduce((a,p)=>a+p.duplicates.length,0));
}).catch(e=>console.error(e));
