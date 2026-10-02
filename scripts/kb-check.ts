import path from "node:path";
import { KnowledgeBase, loadChunksFromDir } from "../lib/knowledge";

const kb = new KnowledgeBase(loadChunksFromDir(path.join(process.cwd(), "knowledge")));
console.log(`Loaded ${kb.size} knowledge chunks.\n`);

const queries = process.argv.slice(2);
for (const q of queries.length ? queries : ["Do you offer Invisalign?", "Where are you located?", "Do you accept insurance?"]) {
  console.log(`Q: ${q}`);
  for (const h of kb.search(q, 3)) console.log(`  ${h.score.toFixed(2)}  ${h.source} › ${h.heading}`);
}
