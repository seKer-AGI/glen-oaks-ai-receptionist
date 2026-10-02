import { beforeEach, describe, expect, it } from "vitest";
import { countWords } from "@/lib/responseLength";
import { SPOKEN } from "@/lib/config";
import { appointmentSnapshot, handleUserTurn, type Deps } from "@/lib/receptionist";
import { listAppointmentRequests } from "@/lib/appointments";
import { FIXED_NOW, freshDb, kb, newSession, scriptedLlm, toolCall } from "./helpers";

const deps = (llm: Deps["llm"]): Deps => ({ llm, kb: kb(), now: () => FIXED_NOW });

beforeEach(async () => {
  await freshDb();
});

describe("answers", () => {
  it("passes retrieved knowledge to the LLM and speaks its short answer", async () => {
    const llm = scriptedLlm([{ content: "Yes, Invisalign is available for orthodontic treatment." }]);
    const s = newSession();
    const { reply } = await handleUserTurn(s, "Do you offer Invisalign?", deps(llm));
    expect(reply).toBe("Yes, Invisalign is available for orthodontic treatment.");
    const system = llm.calls[0].messages[0].content!;
    expect(system).toMatch(/Invisalign/);
    expect(system).toMatch(/NEVER more than 20 words/);
  });

  it("never speaks more than 20 words even if the LLM rambles", async () => {
    const rambling =
      "Yes we absolutely do offer Invisalign here and our orthodontists would be delighted to evaluate you at either of our two lovely offices soon.";
    const llm = scriptedLlm([{ content: rambling }, { content: rambling }, { content: rambling }]);
    const { reply } = await handleUserTurn(newSession(), "Do you offer Invisalign?", deps(llm));
    expect(countWords(reply)).toBeLessThanOrEqual(20);
  });

  it("regenerates when too long and uses the short rewrite", async () => {
    const llm = scriptedLlm([
      { content: Array(30).fill("word").join(" ") },
      { content: "We have offices in Glen Oaks and Jamaica." },
    ]);
    const { reply } = await handleUserTurn(newSession(), "Where are you located?", deps(llm));
    expect(reply).toBe("We have offices in Glen Oaks and Jamaica.");
  });

  it("falls back to a spoken error when the LLM fails", async () => {
    const llm = { complete: async () => { throw new Error("down"); } };
    const { reply } = await handleUserTurn(newSession(), "Where are you located?", deps(llm));
    expect(reply).toBe(SPOKEN.connection);
  });

  it("handles emergencies without calling the LLM", async () => {
    const llm = scriptedLlm([]);
    const { reply } = await handleUserTurn(newSession(), "My tooth got knocked out!", deps(llm));
    expect(reply).toBe(SPOKEN.emergency);
    expect(llm.calls).toHaveLength(0);
    expect(countWords(reply)).toBeLessThanOrEqual(20);
  });

  it("handles 'wait' and 'hello?' deterministically", async () => {
    const llm = scriptedLlm([]);
    const s = newSession();
    expect((await handleUserTurn(s, "Wait.", deps(llm))).reply).toBe(SPOKEN.hold);
    expect((await handleUserTurn(s, "Hello?", deps(llm))).reply).toBe(SPOKEN.here);
    expect(llm.calls).toHaveLength(0);
  });
});

describe("appointment workflow", () => {
  it("collects five fields one at a time, saves, and says the thank-you line", async () => {
    const s = newSession();
    // Only the first turn (intent) needs the LLM; plain answers are handled by the fast path.
    const llm = scriptedLlm([
      { toolCalls: [toolCall({ wants_appointment: true })] },
      { content: "Absolutely. May I have your full name?" },
    ]);
    const d = deps(llm);

    expect((await handleUserTurn(s, "I'd like to book an appointment.", d)).reply).toMatch(/full name/);
    expect(s.booking).toBe(true);
    expect((await handleUserTurn(s, "John Smith.", d)).reply).toBe("Thanks, John. What's your address?");
    expect((await handleUserTurn(s, "123 Main Street, Queens.", d)).reply).toMatch(/phone/);
    expect((await handleUserTurn(s, "718-555-1234.", d)).reply).toMatch(/date/);
    expect((await handleUserTurn(s, "October 10th.", d)).reply).toMatch(/reason/);
    expect(await listAppointmentRequests()).toHaveLength(0); // nothing saved before all five

    const final = await handleUserTurn(s, "An Invisalign consultation at the Jamaica office.", d);
    expect(final.reply).toBe("Thank you. We'll reach out to you shortly.");
    expect(final.reply).not.toMatch(/confirm/i);
    expect(final.saved?.id).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(2); // no LLM calls for the five answers

    const rows = await listAppointmentRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: "John Smith",
      address: "123 Main Street, Queens",
      phone: "718-555-1234",
      preferred_date: "2026-10-10",
      reason: "An Invisalign consultation",
      location: "Jamaica",
      status: "new",
    });
    expect(s.booking).toBe(false);
    expect(s.transcript.at(-1)?.text).toBe(SPOKEN.completed);
  });

  it("keeps showing the saved details after the request is saved", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "A Person", address: "1 Main St", phone: "718-555-1234", preferred_date: "2026-10-10" };
    await handleUserTurn(s, "A cleaning.", deps(scriptedLlm([])));
    const snap = appointmentSnapshot(s);
    expect(snap.booking).toBe(false);
    expect(snap.savedId).toBeGreaterThan(0);
    expect(snap.fields.full_name).toBe("A Person");
    expect(snap.fields.reason).toBe("A cleaning");
  });

  it("forces the tool call while booking (tool_choice required)", async () => {
    const s = newSession();
    s.booking = true;
    const llm = scriptedLlm([{ toolCalls: [toolCall({})] }, { content: "May I have your full name?" }]);
    await handleUserTurn(s, "Hm, okay", deps(llm));
    expect(llm.calls[0].toolChoice).toBe("required");
  });

  it("lets the patient correct a stored detail", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John" };
    const llm = scriptedLlm([
      { toolCalls: [toolCall({ full_name: "Michael Brown" })] },
    ]);
    const { reply } = await handleUserTurn(s, "Actually, sorry, my name is Michael Brown.", deps(llm));
    expect(s.appointment.full_name).toBe("Michael Brown");
    expect(reply).toBe("No problem, Michael. What's your address?");
    expect(llm.calls).toHaveLength(1); // fast path: no second LLM round trip
  });

  it("asks politely to repeat an unusable phone number instead of saying it is invalid", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John Smith", address: "123 Main St" };
    const llm = scriptedLlm([{ toolCalls: [toolCall({ phone: "555-12" })] }]);
    const { reply } = await handleUserTurn(s, "uh it's five five five twelve", deps(llm));
    expect(s.appointment.phone).toBeUndefined();
    expect(reply).toBe("Sorry, could you repeat your phone number?");
    expect(reply).not.toMatch(/invalid|incorrect|must|format|digits/i);
    expect(llm.calls).toHaveLength(0); // deterministic re-ask: instant, no LLM round trip
  });

  it("does not choose a location from the home address; keeps null when unspecified", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "A Person", address: "1 Main St Jamaica NY", phone: "718-555-1234", preferred_date: "2026-10-10" };
    const llm = scriptedLlm([{ toolCalls: [toolCall({ reason: "Cleaning" })] }]);
    const out = await handleUserTurn(s, "A cleaning.", deps(llm));
    expect(out.saved?.location).toBeNull();
  });

  it("returns a short spoken error if the database save fails and keeps the details", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "A Person", address: "1 Main St", phone: "718-555-1234", preferred_date: "2026-10-10" };
    const llm = scriptedLlm([{ toolCalls: [toolCall({ reason: "Cleaning" })] }]);
    const out = await handleUserTurn(s, "A cleaning.", {
      ...deps(llm),
      saveRequest: async () => { throw new Error("db down"); },
    });
    expect(out.reply).toBe(SPOKEN.dbError);
    expect(s.appointment.reason).toBe("A cleaning");
  });
});

describe("streaming", () => {
  const streamingLlm = (reply: string): Deps["llm"] => ({
    complete: async () => ({ content: reply, toolCalls: [] }),
    completeStream: async (_req, onText) => {
      for (let i = 0; i < reply.length; i += 4) onText(reply.slice(i, i + 4));
      return { content: reply, toolCalls: [] };
    },
  });

  it("shows text as it streams and releases sentences for speech immediately", async () => {
    const texts: string[] = [];
    const spoken: string[] = [];
    const { reply } = await handleUserTurn(newSession(), "Do you offer Invisalign?", {
      ...deps(streamingLlm("Yes, Invisalign is available. Would you like to book?")),
      onText: (t) => texts.push(t),
      onSpeak: (t) => spoken.push(t),
    });
    expect(texts.length).toBeGreaterThan(3); // partial text arrived progressively
    expect(texts[0].length).toBeLessThan(texts.at(-1)!.length);
    expect(spoken).toEqual(["Yes, Invisalign is available.", "Would you like to book?"]);
    expect(reply).toBe("Yes, Invisalign is available. Would you like to book?");
  });

  it("releases the first phrase for speech BEFORE the model has finished generating", async () => {
    const reply = "Yes, we offer Invisalign clear aligners, and our orthodontists can help. Would you like a consultation?";
    const events: string[] = [];
    const slowLlm: Deps["llm"] = {
      complete: async () => ({ content: reply, toolCalls: [] }),
      completeStream: async (_req, onText) => {
        for (let i = 0; i < reply.length; i += 6) {
          onText(reply.slice(i, i + 6));
          await new Promise((r) => setTimeout(r, 15));
        }
        events.push("llm-finished");
        return { content: reply, toolCalls: [] };
      },
    };
    const out = await handleUserTurn(newSession(), "Do you offer Invisalign?", {
      ...deps(slowLlm),
      onText: () => events.length === 0 && !events.includes("first-text") && events.push("first-text"),
      onSpeak: (c) => events.push(`speak:${c}`),
    });
    expect(events[0]).toBe("first-text");
    expect(events[1]).toMatch(/^speak:Yes, we offer Invisalign clear aligners,/);
    expect(events.indexOf("llm-finished")).toBeGreaterThan(1); // speech started while still generating
    expect(out.reply).toBe(reply);
  });

  it("caps streamed speech at 20 words even when the model keeps talking", async () => {
    const long = "We have offices in Glen Oaks and Jamaica, both in Queens. Our team offers general, cosmetic, implant and orthodontic care for the whole family. Please call.";
    const spoken: string[] = [];
    const { reply } = await handleUserTurn(newSession(), "Where are you located?", {
      ...deps(streamingLlm(long)),
      onSpeak: (t) => spoken.push(t),
    });
    expect(countWords(spoken.join(" "))).toBeLessThanOrEqual(20);
    expect(countWords(reply)).toBeLessThanOrEqual(20);
    expect(reply).toBe(spoken.join(" "));
  });

  it("falls back to shortening when the first sentence alone is too long", async () => {
    const spoken: string[] = [];
    const longOne = "Yes we absolutely do offer Invisalign here and our orthodontists would be delighted to evaluate you at either of our two lovely offices soon.";
    const { reply } = await handleUserTurn(newSession(), "Do you offer Invisalign?", {
      ...deps(streamingLlm(longOne)),
      onSpeak: (t) => spoken.push(t),
    });
    expect(spoken).toEqual([]); // nothing was spoken mid-stream
    expect(countWords(reply)).toBeLessThanOrEqual(20); // route speaks the validated reply instead
  });
});

describe("relaxed collection", () => {
  it("accepts an international phone number on the first try", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "Ali Khan", address: "12 Mall Road, Lahore" };
    const llm = scriptedLlm([{ toolCalls: [toolCall({ phone: "+92 300 1234567" })] }]);
    const { reply } = await handleUserTurn(s, "My number is plus nine two three zero zero one two three four five six seven", deps(llm));
    expect(s.appointment.phone).toBe("+923001234567");
    expect(reply).toMatch(/date/);
  });

  it("never gets stuck: after two failed tries the patient's own words are kept", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "Ali Khan", address: "12 Mall Road" };
    const llm = scriptedLlm([
      { toolCalls: [toolCall({ phone: "123" })] },
      { toolCalls: [toolCall({ phone: "123" })] },
    ]);
    const first = await handleUserTurn(s, "123", deps(llm));
    expect(first.reply).toBe("Sorry, could you repeat your phone number?");
    expect(s.appointment.phone).toBeUndefined();
    const second = await handleUserTurn(s, "123", deps(llm));
    expect(s.appointment.phone).toBe("123");
    expect(second.reply).toMatch(/date/); // moved on to the next question
  });

  it("keeps a date it cannot parse as free text so the saved request still goes through", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "Ali Khan", address: "12 Mall Road", phone: "718-555-1234", reason: "Cleaning" };
    const llm = scriptedLlm([
      { toolCalls: [toolCall({ preferred_date: "sometime after the holidays" })] },
      { toolCalls: [toolCall({ preferred_date: "sometime after the holidays" })] },
    ]);
    expect((await handleUserTurn(s, "sometime after the holidays", deps(llm))).reply).toBe("Sorry, what date works for you?");
    const out = await handleUserTurn(s, "sometime after the holidays", deps(llm));
    expect(out.reply).toBe("Thank you. We'll reach out to you shortly.");
    expect(out.saved?.preferred_date).toBe("sometime after the holidays");
  });

  it("Test 7: an unclear phone answer gets a polite re-ask, never 'invalid'", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John Smith", address: "123 Main St" };
    const llm = scriptedLlm([]);
    const { reply } = await handleUserTurn(s, "Um, I don't really remember it right now.", deps(llm));
    expect(reply).toBe("Sorry, could you repeat your phone number?");
    expect(s.appointment.phone).toBeUndefined();
    expect(llm.calls).toHaveLength(0);
  });

  it("does not loop forever on a phone number: after a second non-answer it moves on", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John Smith", address: "123 Main St" };
    const llm = scriptedLlm([]);
    await handleUserTurn(s, "I'd rather not say", deps(llm));
    const second = await handleUserTurn(s, "I really don't remember it", deps(llm));
    expect(s.appointment.phone).toBe("Not provided");
    expect(second.reply).toMatch(/date/);
  });

  it("lets a patient who says 'sorry, I said that wrong' simply try again", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John Smith", address: "123 Main St", phone: "718-555-1234" };
    const llm = scriptedLlm([
      { toolCalls: [toolCall({})] },
      { content: "No problem. What's the best phone number?" },
    ]);
    const { reply } = await handleUserTurn(s, "Sorry, I said that wrong.", deps(llm));
    expect(reply).toMatch(/phone|date/i);
    expect(reply).not.toMatch(/invalid|incorrect/i);
  });

  describe("phone number variations (no LLM needed)", () => {
    const cases: [string, string][] = [
      ["7185551234", "718-555-1234"],
      ["718-555-1234", "718-555-1234"],
      ["(718) 555-1234", "718-555-1234"],
      ["718 555 1234", "718-555-1234"],
      ["My number is 718 555 1234", "718-555-1234"],
      ["seven one eight five five five one two three four", "718-555-1234"],
      ["My phone is seven one eight, five five five, twelve thirty-four.", "718-555-1234"],
      ["My number is 718-555-1234... actually, sorry, it's 718-555-5678.", "718-555-5678"],
    ];
    for (const [said, stored] of cases) {
      it(`accepts: ${said}`, async () => {
        const s = newSession();
        s.booking = true;
        s.appointment = { full_name: "John Smith", address: "123 Main St" };
        const llm = scriptedLlm([]);
        const { reply } = await handleUserTurn(s, said, deps(llm));
        expect(s.appointment.phone).toBe(stored);
        expect(reply).toMatch(/date/);
        expect(reply).not.toMatch(/invalid|incorrect|valid|digits|format/i);
        expect(llm.calls).toHaveLength(0);
      });
    }
  });
});

