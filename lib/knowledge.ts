import fs from "node:fs";
import path from "node:path";

export interface KnowledgeChunk {
  id: string;
  source: string;
  heading: string;
  text: string;
}

export interface SearchHit extends KnowledgeChunk {
  score: number;
}

const STOPWORDS = new Set(
  "a an the and or of to in on at for is are do does you your we our i me my can could would will it this that with about have has what how where when who which any there be as if so just please tell want like need offer offers provide".split(" "),
);

// Maps patient wording to terms used in the knowledge documents.
const SYNONYMS: Record<string, string[]> = {
  braces: ["orthodontics", "orthodontist"],
  straighten: ["orthodontics", "invisalign"],
  aligner: ["invisalign"],
  hours: ["hours", "open", "monday", "saturday"],
  open: ["hours", "monday", "saturday"],
  close: ["hours"],
  address: ["address", "location"],
  where: ["location", "address"],
  office: ["location"],
  located: ["location", "address"],
  directions: ["location", "parking"],
  insurance: ["insurance", "ppo", "indemnity"],
  cost: ["payment", "insurance"],
  price: ["payment", "insurance"],
  pay: ["payment"],
  financing: ["payment", "carecredit"],
  scared: ["sedation", "anxiety"],
  nervous: ["sedation", "anxiety"],
  anxiety: ["sedation"],
  sleep: ["sedation"],
  nitrous: ["sedation"],
  wisdom: ["oral", "surgery", "extraction"],
  extraction: ["oral", "surgery"],
  kids: ["pediatric"],
  child: ["pediatric"],
  children: ["pediatric", "orthodontics"],
  gums: ["gum", "periodontics"],
  periodontal: ["gum", "periodontics"],
  whitening: ["cosmetic"],
  smile: ["cosmetic"],
  dentist: ["doctors"],
  doctor: ["doctors"],
  emergency: ["emergency", "walk-in"],
  urgent: ["emergency"],
  walkin: ["walk-in", "emergency"],
  services: ["services", "overview"],
  jaw: ["tmj"],
  grinding: ["tmj"],
};

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const SYN = new Map(Object.entries(SYNONYMS).map(([k, v]) => [stem(k), v]));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

function chunkMarkdown(source: string, md: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (heading && text) {
      chunks.push({ id: `${source}#${chunks.length}`, source, heading, text });
    }
    buf = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
    } else if (!line.startsWith("# ")) {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

export class KnowledgeBase {
  private docs: { chunk: KnowledgeChunk; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(chunks: KnowledgeChunk[]) {
    for (const chunk of chunks) {
      // Heading words are repeated so heading matches outrank incidental body mentions.
      const tokens = tokenize(`${chunk.heading} ${chunk.heading} ${chunk.source} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, len: tokens.length });
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, k = 3, minScore = 0.5): SearchHit[] {
    const base = tokenize(query);
    const terms = new Set<string>();
    for (const t of base) {
      terms.add(t);
      for (const s of SYN.get(t) ?? []) terms.add(stem(s));
    }
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.75;
    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen));
      }
      if (score >= minScore) hits.push({ ...d.chunk, score });
    }
    return hits.sort((a, b2) => b2.score - a.score).slice(0, k);
  }
}

export function loadChunksFromDir(dir: string): KnowledgeChunk[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => chunkMarkdown(f.replace(/\.md$/, ""), fs.readFileSync(path.join(dir, f), "utf8")));
}

const g = globalThis as unknown as { __kb?: KnowledgeBase };

export function getKnowledgeBase(): KnowledgeBase {
  if (!g.__kb) {
    g.__kb = new KnowledgeBase(loadChunksFromDir(path.join(process.cwd(), "knowledge")));
  }
  return g.__kb;
}

export function formatContext(hits: SearchHit[]): string {
  return hits.map((h) => `[${h.source}: ${h.heading}] ${h.text}`).join("\n");
}
