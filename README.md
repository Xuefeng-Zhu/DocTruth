# DocTruth

**Docs answers that show their receipts.**

Ask a question about a public GitHub project or audit an answer you already have. DocTruth checks claims against selected Markdown passages and links to source lines when Clocked returns evidence. When Clocked flags a disagreement, DocTruth shows both passages and accounts for the conflict when drafting or repairing the answer.

Use **Docs drift scan** to look for conflicting defaults, versions, and requirements across documentation pages. A fact sheet lines up each page's settings, read verbatim by Clocked Extract. Copy the findings as Markdown for a GitHub issue.

Built for the [Clocked Build Challenge 2026](https://clocked.rezolve.ai/challenge). Watch the [demo with voiceover (1:43)](demo/doctruth-demo.mp4).

## Run locally

Use Node.js 24 or later, npm, and a [Clocked API key](https://clocked.rezolve.ai).

```bash
git clone https://github.com/Xuefeng-Zhu/DocTruth.git
cd DocTruth
npm ci
cp .env.example .env.local
```

Set `CLOCKED_API_KEY` in `.env.local`, then start the development server.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Environment variable | Required | Purpose |
| --- | --- | --- |
| `CLOCKED_API_KEY` | Yes | Server-side key for questions, audits, and drift scans. |
| `GITHUB_TOKEN` | No | Raises the GitHub API rate limit for repository metadata and tree requests. |
| `DOCTRUTH_RATE_LIMIT` | No | Caps combined question, audit, and drift requests per IP in a 10-minute window. Defaults to 30 per server process. |
| `CLOCKED_BASE_URL` | No | Overrides the server-side Clocked API base URL. |
| `NEXT_PUBLIC_SAMPLE_REPO_URL` | No | Overrides the GitHub URL prefix for sample evidence links. For a custom sample, use `https://github.com/OWNER/REPO/blob/REF/sample-docs`. |

## Try it in the browser

1. Leave **Sample project** selected to use Tidepool, a fictional job queue with seven docs pages. In **Ask & verify**, try **Audit a chatbot’s answer** to check a pasted answer about the dashboard. Click a claim to inspect its verdict and any evidence.
2. Open **Docs drift scan**, then click **Scan docs for drift**. Look for the dashboard port conflict. The [sample README](sample-docs/README.md) says 4000, while the [dashboard guide](sample-docs/docs/dashboard.md) says 3000. Select at least two pages to rescan, or use **Copy as GitHub issue** to copy the findings to your clipboard.
3. To use your own source, choose **GitHub repo**, enter a public repository such as `owner/repo` or a docs subdirectory such as `owner/repo/docs`, and click **Load docs**. You can also paste a GitHub repository or folder URL, or specify a ref such as `owner/repo@v1.2.0`. Add optional version or platform context when asking a question.

The Tidepool installation commands and conflicting settings are part of the synthetic sample. They let you see how DocTruth handles conflicting sources and unsupported claims.

## Try it from the command line

Run these commands from the repository root. The standalone scripts load your key through Node's `--env-file` flag.

```bash
# Ask about the sample.
node --env-file=.env.local --import tsx scripts/try.ts "How many times is a failed job retried?"

# Audit a pasted answer.
node --env-file=.env.local --import tsx scripts/try.ts "What port does the dashboard use?" "It uses port 4000."

# Ask about a public repo. The empty second argument leaves audit mode off.
node --env-file=.env.local --import tsx scripts/try.ts "How do I set a timeout?" "" sindresorhus/ky

# Scan the sample for drift. Pass owner/repo to scan a public repo instead.
node --env-file=.env.local --import tsx scripts/drift.ts
```

## How it uses Clocked

| Step | What DocTruth does |
| --- | --- |
| Retrieve | A local BM25 search selects up to 40 Markdown sections for the first Rerank pass. |
| Rank with **Rerank** (`/rerank`) | Prioritizes sections marked `use` and can rerank unseen neighbors of sections marked `expand`. An answer uses up to eight sections. If none are marked `use`, DocTruth skips drafting or audits a pasted answer against up to five closest sections. |
| Cross-check with **Compare** (`/compare`) | When the selected sections span multiple pages, Compare flags disagreements. DocTruth shows the conflicts and passes them to Fill. |
| Draft with **Fill** (`/fill`) | Drafts an answer from the selected passages. Audit mode starts with the pasted answer. |
| Check with **Verify** (`/grounding`) | Classifies claims as supported, contradicted, or not stated in batches of up to 30. A claim attributed to a single identified page is checked against that page. When verification uses multiple batches, **Decide** (`/decide`) scores whether the full answer addresses the question. |
| Repair with **Fill** and **Verify** | Rewrites unsupported claims and checks the result again. DocTruth keeps a verified rewrite if it has fewer unsupported claims, or if the count ties and its grounding score improves. Empty or unverified rewrites leave the original answer in place. |
| Scan for drift with **Compare** (`/compare`) | Compares every pair among two to eight selected pages, using up to 16,000 characters per page. The report shows flagged conflicts and counts repeated passages. |
| Read facts with **Extract** (`/extract`) | Runs alongside the drift scan, one call per page. Copies each page's settings (defaults, versions, ports, limits, flags, environment variables) verbatim with exact offsets. DocTruth lines the values up across pages in a fact sheet, links each value to its source line, and marks every mismatch as confirmed by Compare or caught only by Extract. In the Tidepool sample, Extract catches the Redis 6.2 vs 7.0 requirement that Compare does not flag. Mismatches appear in the copied GitHub issue. |

The app displays Clocked credits for completed runs and end-to-end timing for questions and audits.

## Data and limits

- The GitHub loader reads up to 80 Markdown or MDX files, with a cap of 60,000 characters per file. It prioritizes the root README and documentation directories.
- The web app accepts pasted answers up to 8,000 characters.
- DocTruth has no application database. It reuses GitHub docs from its in-memory cache for up to 30 minutes. Clocked receives documentation passages and related paths or headings, the question, optional ranking context, and the answer text it checks or repairs, including pasted answers.
- Verification measures support in the selected passages. A claim marked **not stated** may still be true or documented elsewhere. Drift scans cover the selected pages and can miss conflicts outside that scope.

## Repository guide

| Path | Role |
| --- | --- |
| [`src/app/page.tsx`](src/app/page.tsx) | Browser UI for questions, audits, evidence, and drift reports. |
| [`src/app/api/`](src/app/api) | `POST /api/corpus` lists available docs, `POST /api/ask` streams newline-delimited JSON events, and `POST /api/drift` returns a JSON report. |
| [`src/lib/corpus.ts`](src/lib/corpus.ts) | GitHub loader, Markdown chunking, and BM25 retrieval. |
| [`src/lib/pipeline.ts`](src/lib/pipeline.ts), [`src/lib/drift.ts`](src/lib/drift.ts), [`src/lib/facts.ts`](src/lib/facts.ts) | Question, audit, drift, and fact-sheet workflows. |
| [`src/lib/clocked.ts`](src/lib/clocked.ts) | Server-side Clocked client with retries, idempotency keys, and credit tracking. |
| [`src/lib/sample.ts`](src/lib/sample.ts), [`sample-docs/`](sample-docs/) | Tidepool source fixtures and exported Markdown used for line links. |

If you change the Tidepool fixtures in `src/lib/sample.ts`, run `node --import tsx scripts/export-sample.ts` from the repository root. Publish the exported pages alongside the fixture changes so evidence links land on the right lines.

## License

[MIT](LICENSE)
