// Extract the hard facts (defaults, ports, versions, limits, flags, env vars) from each page,
// verbatim and with exact offsets, then line them up across pages.
import { clocked } from "./clocked";
import type { CompareFinding } from "./types";

export type Fact = { path: string; setting: string; value: string; start: number; end: number; confidence: number };

export type FactRow = {
  key: string;
  label: string;
  entries: Fact[]; // one per page that states it
  mismatch: boolean; // pages give different values
  confirmed: boolean; // a Compare conflict covers two of these values
};

type Cell = { value: string | null; start?: number; end?: number; confidence?: number };
type ExtractResp = {
  fields: { facts: { value: ({ setting: string | null; value: string | null } | null)[]; items?: { start: number; end: number; fields: { setting?: Cell; value?: Cell } }[] } };
};

const INSTRUCTIONS =
  "This is one page of a software project's documentation. Read only facts the page states as current: configuration defaults, ports, " +
  "version requirements, limits, retry counts, timeouts, environment variables, CLI flags and command values. Copy values verbatim. " +
  "Ignore examples that the page says are only illustrations.";

export async function extractFacts(path: string, text: string) {
  const r = await clocked<ExtractResp>("extract", {
    text,
    instructions: INSTRUCTIONS,
    fields: {
      facts: {
        description: "configuration setting, default, requirement, limit or version the page states",
        list: true,
        max_items: 24,
        row_anchor: "setting",
        fields: {
          setting: "name of the setting, option, flag, environment variable or requirement",
          value: "its stated value, default or required version",
        },
      },
    },
  });
  const items = r.data.fields?.facts?.items || [];
  const facts: Fact[] = [];
  for (const it of items) {
    const s = it.fields?.setting;
    const v = it.fields?.value;
    if (!s?.value || !v?.value) continue;
    facts.push({
      path,
      setting: s.value,
      value: v.value,
      start: Math.min(s.start ?? it.start, v.start ?? it.start),
      end: Math.max(s.end ?? it.end, v.end ?? it.end),
      confidence: Math.min(s.confidence ?? 1, v.confidence ?? 1),
    });
  }
  return { facts, credits: r.credits, ms: r.ms };
}

const STOP = new Set(["the", "a", "an", "is", "are", "of", "or", "and", "to", "by", "default", "defaults", "newer", "later", "older", "above", "least", "at", "times", "time", "version", "v", "minimum", "min", "max", "maximum", "on", "set", "be"]);

/** A comparable key for a setting: the words of its name, minus the value itself, numbers and filler. */
export function settingKey(setting: string, value: string) {
  let s = setting.toLowerCase();
  if (value) s = s.split(value.toLowerCase()).join(" ");
  const words = s
    .replace(/[`*"'()[\]{}:=,.]/g, " ")
    .replace(/^-+|\s-+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^[\d.x]+$/.test(w) && !STOP.has(w));
  return words.join(" ").trim();
}

const normValue = (v: string) => v.toLowerCase().replace(/[`*"'\s]/g, "").replace(/ornewer|orlater|\+$/g, "");

export function lineUp(facts: Fact[], conflicts: CompareFinding[]): FactRow[] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    const key = settingKey(f.setting, f.value);
    if (!key) continue;
    const g = groups.get(key) || [];
    // one entry per page: keep the most confident
    const prev = g.findIndex((x) => x.path === f.path);
    if (prev >= 0) {
      if (f.confidence > g[prev].confidence) g[prev] = f;
    } else g.push(f);
    groups.set(key, g);
  }
  const covers = (c: CompareFinding["a"], f: Fact) => c.document === f.path && c.start <= f.end && c.end >= f.start;
  const rows: FactRow[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const mismatch = new Set(entries.map((e) => normValue(e.value))).size > 1;
    const confirmed =
      mismatch &&
      conflicts.some((c) => entries.some((x) => covers(c.a, x)) && entries.some((y) => covers(c.b, y)));
    const e0 = entries[0];
    const label = e0.setting.replace(e0.value, "").replace(/[`*]/g, "").replace(/\s+/g, " ").trim() || e0.setting;
    rows.push({ key, label, entries, mismatch, confirmed });
  }
  return rows.sort((a, b) => Number(b.mismatch) - Number(a.mismatch) || b.entries.length - a.entries.length);
}
