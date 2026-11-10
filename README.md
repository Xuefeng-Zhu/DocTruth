# DocTruth

**Docs answers that show their receipts.**

Ask a question about any public GitHub project and DocTruth answers it from the project's own Markdown docs, then proves it: every claim is checked against the docs, every supported claim links to the exact line, and when two pages of the docs disagree, DocTruth says so instead of silently picking one. Paste an answer from ChatGPT, Copilot or your support bot and DocTruth audits it the same way, then repairs it.

A second tool, **Docs drift scan**, compares the pages of a project's docs against each other and lists every contradiction (versions, defaults, ports, limits), ready to paste as a GitHub issue.

Built for the [Clocked Build Challenge 2026](https://clocked.rezolve.ai/challenge).

> Demo video (1:43, with voiceover): [demo/doctruth-demo.mp4](demo/doctruth-demo.mp4) · Sample project: [`sample-docs/`](sample-docs) (fictional, synthetic docs with planted drift)

---

## Who it's for

- **Developers** who ask an AI about a library and get a confident answer with a flag that doesn't exist or a default from two versions ago.
- **Maintainers and docs teams** whose README, guides and FAQ drift apart release after release. Users find the contradiction first; DocTruth finds it before them.
- **Teams running a docs chatbot** that need a gate: only answers grounded in the docs reach users.

## How it uses Clocked

DocTruth is built around Clocked's knowledge layer, **Verify, Compare and Rerank**, with Fill and Decide in supporting roles. Every call's output changes what the app does or shows.

| Step | Clocked endpoint | What its output decides |
| --- | --- | --- |
| 1. Retrieve | (local BM25) | Bounds the candidate set to 40 sections so Rerank cost stays predictable. |
| 2. Rank | **Rerank** `/rerank` | `use` sections become the sources. `expand` means "right page, answer is nearby": DocTruth pulls the neighbouring sections and reranks them in a second round. `skip` sections (with reason `unrelated` or `different_case`) are dropped. Optional user context (version, platform) is passed as Rerank `context`. If nothing is `use`, DocTruth refuses to answer instead of guessing. |
| 3. Cross-check sources | **Compare** `/compare` | The chosen sources are compared with each other. Any `conflicts` are shown to the user with both passages, **and** fed into the drafting instructions so the answer reports the disagreement ("README.md says X, while docs/install.md says Y"). |
| 4. Draft | Fill `/fill` (generate field) | Writes the answer from the sources only. Skipped in audit mode, where the user pastes someone else's answer. |
| 5. Verify | **Verify** `/grounding` | Every sentence gets `supported` / `contradicted` / `not_stated` with probabilities and an evidence quote. Sentences that attribute something to one page ("README.md says…") are verified against that page alone, so an honest report of a disagreement isn't marked as contradicted by the other page. The UI highlights each claim and links its evidence to the line on GitHub. |
| 5b. Relevance | Decide `/decide` | When claims were checked in page-scoped groups, Decide scores whether the whole answer addresses the question. |
| 6. Repair | Fill + Verify | Unsupported claims (with the passage that contradicts them) go back into Fill as "remove or correct these". The rewrite is re-verified and kept **only if** it has fewer unsupported claims. |
| Drift scan | **Compare** `/compare` | Up to 8 whole pages, every pair compared; conflicts listed side by side with line links, exportable as a GitHub issue. |

Typical cost on the sample project: 30 to 60 credits per question end to end, about 3 seconds. A drift scan of 7 pages (21 pairs): about 26 credits.

### Example (sample project)

Pasted answer: *"The Tidepool dashboard runs on port 4000 and is read-only, so it cannot delete jobs. You can turn on single sign-on with the --sso flag."*

- Rerank: `README.md › Dashboard` = **use**; three `docs/dashboard.md` sections = **expand** (right page).
- Compare: README says port **4000**, `docs/dashboard.md` says **3000** → conflict.
- Verify: claim 1 **contradicted** (the dashboard page says it can delete jobs), claim 2 **not stated** (there is no `--sso`). 2% grounded.
- Repair: *"README.md says it opens on port 4000, while docs/dashboard.md says it listens on port 3000 by default. The dashboard can delete jobs."* → **100% grounded**.

## Run it locally

Requirements: Node.js 20+ and a Clocked API key (free account at [clocked.rezolve.ai](https://clocked.rezolve.ai), plus the hackathon credit code from the challenge page).

```bash
git clone https://github.com/Xuefeng-Zhu/doctruth
cd doctruth
npm install
cp .env.example .env.local   # then put your key in CLOCKED_API_KEY
npm run dev                  # http://localhost:3000
```

Environment variables:

| Name | Required | Purpose |
| --- | --- | --- |
| `CLOCKED_API_KEY` | yes | Clocked account API key. Used server-side only, never sent to the browser. |
| `GITHUB_TOKEN` | no | Raises GitHub's API rate limit when loading repos (any read-only token). |
| `DOCTRUTH_RATE_LIMIT` | no | Requests per IP per 10 minutes on a public deployment (default 30). |

Try it from the command line:

```bash
npx tsx scripts/try.ts "How many times is a failed job retried?"
npx tsx scripts/try.ts "What port does the dashboard use?" "It uses port 4000."   # audit mode
npx tsx scripts/try.ts "How do I set a timeout?" "" sindresorhus/ky               # any public repo
npx tsx scripts/drift.ts                                                         # drift scan of the sample
```

## Architecture

```
src/lib/clocked.ts    Clocked client: idempotency keys, retries on 409/429/5xx with the same key, credit tracking
src/lib/corpus.ts     GitHub loader (tree API + raw files, README and docs/ first), heading-aware chunker, BM25 prefilter
src/lib/pipeline.ts   Rerank → expand → Compare → Fill → Verify (+ Decide) → repair; streamed as NDJSON events
src/lib/drift.ts      Whole-page Compare for the drift scan
src/app/api/*         Route handlers: /api/ask (streaming), /api/drift, /api/corpus
src/app/page.tsx      UI: live pipeline, claim highlighting, evidence links, Rerank table, drift report
sample-docs/          The synthetic Tidepool docs used in the demo
```

## Data and limits

- Only public GitHub repos and the bundled synthetic sample are read. Nothing is stored; loaded docs are cached in memory for 30 minutes.
- Up to 80 Markdown files per repo; translated docs, tests and vendored folders are skipped.
- Verify measures support in the docs, not truth in the world. A claim marked "not in docs" may still be true; it just isn't documented.

## License

MIT
