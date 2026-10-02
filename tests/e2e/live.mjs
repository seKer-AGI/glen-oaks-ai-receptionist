// LIVE test: uses your real OpenAI key + real Postgres. A synthetic "patient voice" is made with
// OpenAI TTS and sent through /api/voice/turn exactly like the browser would.
//   BASE=http://localhost:3200 node --env-file=.env.local tests/e2e/live.mjs
const BASE = process.env.BASE ?? "http://localhost:3200";
const KEY = process.env.OPENAI_API_KEY;
const say = async (text) => {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "onyx", input: text, response_format: "mp3" }),
  });
  return new Blob([await r.arrayBuffer()], { type: "audio/mpeg" });
};
const start = await (await fetch(`${BASE}/api/voice/start`, { method: "POST" })).json();
console.log("AI:", start.greeting);
let saved = null;
for (const line of [
  "Hi, what services do you offer?", "Do you offer Invisalign?", "Where are you located?",
  "Hi, I'd like to book an appointment.", "My name is John Smith.", "123 Main Street, Queens.",
  "718-555-1234.", "October 20th.", "I'd like an Invisalign consultation at the Jamaica office.",
]) {
  const fd = new FormData();
  fd.append("sessionId", start.sessionId);
  fd.append("audio", await say(line), "speech.mp3");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/voice/turn`, { method: "POST", body: fd });
  const ev = [];
  let firstAudioMs = null, buf = "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const e = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
      if (e.type === "audio_chunk" && firstAudioMs === null) firstAudioMs = Date.now() - t0;
      ev.push(e);
    }
  }
  const tr = ev.find((e) => e.type === "transcript"), rp = ev.find((e) => e.type === "reply");
  console.log(`
PATIENT (heard): ${tr?.text}
AI (${rp?.wordCount} words, first audio ${firstAudioMs} ms, total ${Date.now() - t0} ms): ${rp?.text ?? JSON.stringify(ev)}`);
  if (rp?.saved) saved = rp.saved.id;
}
console.log("\nSaved request id:", saved);
