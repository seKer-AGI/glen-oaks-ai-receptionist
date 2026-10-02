import { KnowledgeBase, loadChunksFromDir } from "@/lib/knowledge";
import { newDb } from "pg-mem";
import { setDb } from "@/lib/db";
import { createSession } from "@/lib/session";
import type { LlmClient, LlmRequest, LlmResponse } from "@/lib/receptionist";
import path from "node:path";

export const FIXED_NOW = new Date("2026-10-02T12:00:00Z");

/** Fresh in-memory PostgreSQL (pg-mem); schema is created on first query. */
export async function freshDb() {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  setDb(pool);
  return pool;
}

export function kb() {
  return new KnowledgeBase(loadChunksFromDir(path.join(process.cwd(), "knowledge")));
}

export function newSession() {
  return createSession();
}

/** Scripted fake LLM: each call pops the next response from the queue. */
export function scriptedLlm(responses: Partial<LlmResponse>[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const r = responses.shift() ?? { content: "Okay." };
      return { content: r.content ?? null, toolCalls: r.toolCalls ?? [] };
    },
  };
}

export const toolCall = (args: Record<string, unknown>, id = "c1") => ({
  id,
  name: "update_appointment",
  arguments: JSON.stringify(args),
});
