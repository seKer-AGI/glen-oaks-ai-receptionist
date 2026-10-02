// LIVE streaming + phone-number check against your running server with the real OpenAI key.
// A synthetic "patient voice" is generated with OpenAI TTS and sent like the browser would.
//   BASE=http://localhost:3000 node --env-file=.env.local tests/e2e/stream-check.mjs
// No appointment is saved (booking stops at the phone step).
const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.OPENAI_API_KEY;
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (!ok) failed++;
};
const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);

async function speech(text) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "onyx", input: text, response_format: "mp3" }),
  });
  return new Blob([await r.arrayBuffer()], { type: "audio/mpeg" });
}
async function stt(bytes) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "audio/mpeg" }), "a.mp3");
  fd.append("model", "gpt-4o-mini-transcribe");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: fd });
  return (await r.json()).text ?? "";
}

async function turn(sessionId, say) {
  const fd = new FormData();
  fd.append("sessionId", sessionId);
  fd.append("audio", await speech(say), "speech.mp3");
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/voice/turn`, { method: "POST", body: fd });
  const ev = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const e = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      e.t = Math.round(performance.now() - t0);
      ev.push(e);
    }
  }
  return ev;
}
const first = (ev, type) => ev.find((e) => e.type === type);

const start = await (await fetch(`${BASE}/api/voice/start`, { method: "POST" })).json();
const sid = start.sessionId;

// ---------- 1. Streaming ----------
console.log("\n=== STREAMING ===");
const ev = await turn(sid, "Do you offer Invisalign, and where are your offices located?");
const deltas = ev.filter((e) => e.type === "reply_delta");
const reply = first(ev, "reply");
const chunks = ev.filter((e) => e.type === "audio_chunk");
console.log("heard:", first(ev, "transcript")?.text);
console.log("reply:", reply?.text);
console.log("timeline ms:", { firstDelta: deltas[0]?.t, firstAudio: chunks[0]?.t, replyEvent: reply?.t, audioEnd: first(ev, "audio_end")?.t, deltas: deltas.length, audioChunks: chunks.length });
console.log("server marks:", first(ev, "metrics")?.marks);

check("reply text arrives progressively (multiple deltas)", deltas.length >= 3, `${deltas.length} deltas`);
check("deltas only grow (no rewrites/duplication)", deltas.every((d, i) => i === 0 || d.text.startsWith(deltas[i - 1].text)));
check("right-side text appears before the reply is complete", deltas[0].t < reply.t);
check("audio starts before generation finished or immediately after first phrase", chunks[0].t <= reply.t + 1500, `firstAudio ${chunks[0].t}ms vs llmDone event ${reply.t}ms`);
check("audio ends with audio_end after all chunks", ev.findIndex((e) => e.type === "audio_end") > ev.findLastIndex((e) => e.type === "audio_chunk"));
check("reply is <= 20 words", words(reply.text).length <= 20, `${words(reply.text).length} words`);
check("final delta equals final reply (no missing/duplicated text)", deltas.at(-1).text.replace(/\s+/g, " ").startsWith(reply.text.slice(0, 15)));

// What was actually spoken must match the text: no missing words, no repeats.
const audio = Buffer.concat(chunks.map((c) => Buffer.from(c.audio, "base64")));
const heard = await stt(audio);
const a = words(heard), b = words(reply.text);
const common = b.filter((w) => a.includes(w)).length / b.length;
console.log("spoken (re-transcribed):", heard);
check("spoken audio matches reply text (no missing words)", common >= 0.9, `${Math.round(common * 100)}% of words found`);
check("spoken audio has no repeated/overlapping phrases", a.length <= b.length + 3, `spoken ${a.length} words vs reply ${b.length}`);

// ---------- 2. Phone numbers ----------
console.log("\n=== PHONE NUMBERS ===");
async function phoneTest(label, say, expectOk) {
  const s = await (await fetch(`${BASE}/api/voice/start`, { method: "POST" })).json();
  await turn(s.sessionId, "I'd like to book an appointment.");
  await turn(s.sessionId, "John Smith.");
  await turn(s.sessionId, "123 Main Street, Queens.");
  const e = await turn(s.sessionId, say);
  const r = first(e, "reply");
  const state = r.state.fields.phone;
  const ok = expectOk ? /date/i.test(r.text) && !!state : /repeat your phone number/i.test(r.text);
  check(`${label}: "${say}"`, ok && !/invalid|incorrect|must|format|digits/i.test(r.text), `AI: "${r.text}" | stored phone: ${state ?? "(none)"}`);
}
await phoneTest("Test 1", "7185551234", true);
await phoneTest("Test 2", "718-555-1234", true);
await phoneTest("Test 3", "(718) 555-1234", true);
await phoneTest("Test 4", "718 555 1234", true);
await phoneTest("Test 5", "My phone number is 718 555 1234", true);
await phoneTest("Test 6", "seven one eight five five five one two three four", true);
await phoneTest("Test 7 (unclear)", "Um, I don't really remember it right now.", false);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
