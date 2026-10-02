// TEST HARNESS ONLY. Stands in for the OpenAI HTTP API so the full server pipeline
// (routes -> STT -> retrieval -> LLM tools -> validation -> DB -> TTS stream) can be
// exercised without an API key. Never used by the product itself.
//   node tests/e2e/mock-openai.mjs   (listens on :4010)
import http from "node:http";

const FIELD_BY_QUESTION = [
  [/full name/i, "full_name"],
  [/address/i, "address"],
  [/phone/i, "phone"],
  [/date/i, "preferred_date"],
  [/reason/i, "reason"],
];

function chat(body) {
  const msgs = body.messages;
  const system = msgs[0].content;
  const last = msgs[msgs.length - 1];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const q = system.match(/ask ONLY this one question: "([^"]+)"/)?.[1];

  const reply = (content) => ({ choices: [{ message: { role: "assistant", content } }] });
  const tool = (args) => ({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [
      { id: "call_1", type: "function", function: { name: "update_appointment", arguments: JSON.stringify(args) } },
    ] } }],
  });

  if (!body.tools) return reply("Okay."); // length-rewrite call

  if (last.role === "tool") {
    const next = last.content.match(/ask ONLY this one question: "([^"]+)"/)?.[1];
    return reply(next ? `Thank you. ${next}` : "Okay.");
  }
  if (/appointment|book/i.test(lastUser) && !system.includes("APPOINTMENT MODE is ON")) {
    return tool({ wants_appointment: true });
  }
  if (system.includes("APPOINTMENT MODE is ON") && q) {
    if (!/^\w+:/.test(lastUser)) return tool({ wants_appointment: true });
    const field = FIELD_BY_QUESTION.find(([re]) => re.test(q))?.[1];
    const args = { [field]: lastUser.replace(/^.*?:\s*/, "") };
    if (field === "preferred_date") args.preferred_date = "October 10th";
    return tool(args);
  }
  const k = system.slice(system.lastIndexOf("KNOWLEDGE"));
  if (/invisalign/i.test(lastUser) && /Invisalign/.test(k)) return reply("Yes, Invisalign is available for orthodontic treatment.");
  if (/locat|where/i.test(lastUser)) return reply("We have offices in Glen Oaks and Jamaica.");
  if (/service/i.test(lastUser)) return reply("We offer implants, orthodontics, cosmetic, general dentistry and more services for families here at our busy two office dental practice in Queens.");
  return reply("I can have our team provide that information.");
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };

  if (req.url.endsWith("/audio/transcriptions")) {
    const form = await new Response(buf, { headers: { "content-type": req.headers["content-type"] } }).formData();
    const file = form.get("file");
    // The "audio" in the test is the utterance text itself.
    const text = Buffer.from(await file.arrayBuffer()).toString("utf8").replace(/^RIFF.{0,40}/s, "").trim();
    return json({ text });
  }
  if (req.url.endsWith("/chat/completions")) return json(chat(JSON.parse(buf.toString())));
  if (req.url.endsWith("/audio/speech")) {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    return res.end(Buffer.from("ID3-mock-audio-bytes"));
  }
  res.writeHead(404).end();
}).listen(4010, () => console.log("mock openai on :4010"));
