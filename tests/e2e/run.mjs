// Drives the running server through the acceptance scenario over real HTTP.
// Usage: BASE=http://localhost:3100 node tests/e2e/run.mjs
const BASE = process.env.BASE ?? "http://localhost:3100";
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (!ok) failed++;
};

async function turn(sessionId, utterance) {
  const fd = new FormData();
  fd.append("sessionId", sessionId);
  fd.append("audio", new Blob([utterance], { type: "audio/wav" }), "speech.wav");
  const res = await fetch(`${BASE}/api/voice/turn`, { method: "POST", body: fd });
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const reply = events.find((e) => e.type === "reply");
  const audio = events.find((e) => e.type === "audio");
  return { events, reply, audio };
}

const start = await (await fetch(`${BASE}/api/voice/start`, { method: "POST" })).json();
check("start call returns greeting + audio", !!start.sessionId && !!start.audio, start.greeting);
const sid = start.sessionId;

const script = [
  ["Hi, what services do you offer?", /./],
  ["Do you offer Invisalign?", /Invisalign/],
  ["Where are you located?", /Glen Oaks and Jamaica/],
  ["I'd like to book an appointment.", /full name/i],
  ["name: John Smith", /address/i],
  ["address: 123 Main Street, Queens", /phone/i],
  ["phone: 718-555-1234", /date/i],
  ["date: October 10th", /reason/i],
  ["reason: I'd like an Invisalign consultation", /reach out to you shortly/],
];
for (const [say, expect] of script) {
  const { events, reply, audio } = await turn(sid, say);
  const words = reply?.text.trim().split(/\s+/).length ?? 0;
  check(`"${say}"`, !!reply && expect.test(reply.text) && words <= 20 && !!audio && events.some((e) => e.type === "transcript"), `${reply?.text} (${words}w)`);
}

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD ?? "admin" }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
check("admin login", login.ok && !!cookie);
check("admin API rejects anonymous", (await fetch(`${BASE}/api/admin/requests`)).status === 401);

const { requests } = await (await fetch(`${BASE}/api/admin/requests`, { headers: { cookie } })).json();
const r = requests[0];
check("request saved in DB and visible to admin", requests.length >= 1 && r.full_name === "John Smith" && r.phone === "718-555-1234" && r.preferred_date.endsWith("-10-10") && r.status === "new", JSON.stringify(r));

const detail = await (await fetch(`${BASE}/api/admin/requests/${r.id}`, { headers: { cookie } })).json();
check("transcript stored with request", detail.transcript?.length >= 10, `${detail.transcript?.length} lines`);

const patched = await fetch(`${BASE}/api/admin/requests/${r.id}`, {
  method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ status: "contacted" }),
});
check("status update", (await patched.json()).request.status === "contacted");
check("filter by status", (await (await fetch(`${BASE}/api/admin/requests?status=new`, { headers: { cookie } })).json()).requests.length === 0);
check("search", (await (await fetch(`${BASE}/api/admin/requests?q=smith`, { headers: { cookie } })).json()).requests.length === 1);

const unknown = await fetch(`${BASE}/api/voice/turn`, { method: "POST", body: (() => { const f = new FormData(); f.append("sessionId", "nope"); f.append("event", "silence"); return f; })() });
check("unknown session rejected", unknown.status === 404);

const end = await fetch(`${BASE}/api/voice/end`, { method: "POST", body: JSON.stringify({ sessionId: sid }) });
check("end call", end.ok);

const del = await fetch(`${BASE}/api/admin/requests/${r.id}`, { method: "DELETE", headers: { cookie } });
check("delete request", del.ok);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
