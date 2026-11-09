export type Doc = {
  path: string; // e.g. docs/install.md
  url: string; // link to view on GitHub (or "#sample")
  text: string;
};

export type Chunk = {
  id: string; // unique: path#n
  path: string;
  heading: string; // "Install › Requirements"
  text: string;
  start: number; // char offset in the doc
  line: number; // 1-based line of the chunk start
  seq: number; // order within the doc
};

export type Corpus = {
  source: string; // "sample" or "owner/repo@ref"
  label: string;
  docs: Doc[];
  chunks: Chunk[];
};

export type RerankResult = {
  index: number;
  id?: string;
  action: "use" | "expand" | "skip";
  reason?: string;
  relevance_score: number;
  document_score: number;
  levels: Record<string, number>;
};

export type VerifyClaim = {
  claim: string;
  kind: string;
  counted: boolean;
  weight: number;
  supported: number;
  contradicted: number;
  not_stated: number;
  verdict: "supported" | "contradicted" | "not_stated" | "not_a_claim" | string;
  source: string | null;
  scope?: string; // page this claim was checked against, when it names one
  evidence?: { document: string; quote: string; start: number; end: number; confidence: number };
};

export type VerifyResult = {
  grounded: number;
  ungrounded: number;
  verdict: string;
  threshold: number;
  claims: VerifyClaim[];
  unsupported_claims?: number[];
  answers_question?: number;
  documents?: { id: string; share: number; share_of_answer: number; claims: number[] }[];
};

export type Passage = { document: string; quote: string; start: number; end: number; confidence: number };

export type CompareFinding = {
  kind?: string;
  confidence?: number;
  a: Passage;
  b: Passage;
};

export type ComparePair = {
  a: string;
  b: string;
  relation: string;
  related: number;
  probabilities: Record<string, number>;
  duplicates: CompareFinding[];
  conflicts: CompareFinding[];
};

export type CompareResult = {
  verdict: string;
  pairs: ComparePair[];
  conflicts: number[];
  duplicates: number[];
  overlaps: number[];
};

// Events streamed from /api/ask as NDJSON lines.
export type AskEvent =
  | { type: "stage"; stage: string; status: "running" | "done" | "skipped" | "error"; detail?: string; credits?: number; ms?: number }
  | { type: "candidates"; count: number; total: number }
  | { type: "rerank"; round: number; results: (RerankResult & { chunk: Chunk })[] }
  | { type: "sources"; chunks: Chunk[] }
  | { type: "conflicts"; result: CompareResult; chunks: Chunk[] }
  | { type: "answer"; which: "draft" | "pasted" | "repaired"; text: string }
  | { type: "verify"; which: "draft" | "pasted" | "repaired"; result: VerifyResult }
  | { type: "uncovered"; message: string }
  | { type: "repair_result"; kept: "draft" | "pasted" | "repaired" }
  | { type: "error"; message: string }
  | { type: "done"; credits: number; ms: number };
