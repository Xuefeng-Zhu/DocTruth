import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { SAMPLE_DOCS } from "../src/lib/sample";
for (const d of SAMPLE_DOCS) { const p = `sample-docs/${d.path}`; mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, d.text); }
