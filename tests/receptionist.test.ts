import { beforeEach, describe, expect, it } from "vitest";
import { countWords } from "@/lib/responseLength";
import { SPOKEN } from "@/lib/config";
import { handleUserTurn, type Deps } from "@/lib/receptionist";
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
    const llm = scriptedLlm([
      // 1: "I'd like to book an appointment"
      { toolCalls: [toolCall({ wants_appointment: true })] },
      { content: "Absolutely. May I have your full name?" },
      // 2: name
      { toolCalls: [toolCall({ full_name: "John Smith" })] },
      // 3: address
      { toolCalls: [toolCall({ address: "123 Main Street, Queens" })] },
      // 4: phone
      { toolCalls: [toolCall({ phone: "718-555-1234" })] },
      // 5: date
      { toolCalls: [toolCall({ preferred_date: "2026-10-10" })] },
      // 6: reason + location
      { toolCalls: [toolCall({ reason: "Invisalign consultation", location: "Jamaica" })] },
    ]);
    const d = deps(llm);

    expect((await handleUserTurn(s, "I'd like to book an appointment.", d)).reply).toMatch(/full name/);
    expect(s.booking).toBe(true);
    expect((await handleUserTurn(s, "John Smith.", d)).reply).toMatch(/address/);
    expect((await handleUserTurn(s, "123 Main Street, Queens.", d)).reply).toMatch(/phone/);
    expect((await handleUserTurn(s, "718-555-1234.", d)).reply).toMatch(/date/);
    expect((await handleUserTurn(s, "October 10th.", d)).reply).toMatch(/reason/);
    expect(await listAppointmentRequests()).toHaveLength(0); // nothing saved before all five

    const final = await handleUserTurn(s, "An Invisalign consultation at Jamaica.", d);
    expect(final.reply).toBe("Thank you. We'll reach out to you shortly.");
    expect(final.reply).not.toMatch(/confirm/i);
    expect(final.saved?.id).toBeGreaterThan(0);

    const rows = await listAppointmentRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: "John Smith",
      phone: "718-555-1234",
      preferred_date: "2026-10-10",
      location: "Jamaica",
      status: "new",
    });
    expect(s.booking).toBe(false);
    expect(s.transcript.at(-1)?.text).toBe(SPOKEN.completed);
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

  it("rejects an invalid phone number and asks again instead of saving", async () => {
    const s = newSession();
    s.booking = true;
    s.appointment = { full_name: "John Smith", address: "123 Main St" };
    const llm = scriptedLlm([
      { toolCalls: [toolCall({ phone: "555-12" })] },
      { content: "Sorry, could you repeat that phone number?" },
    ]);
    const { reply } = await handleUserTurn(s, "555 12", deps(llm));
    expect(s.appointment.phone).toBeUndefined();
    expect(reply).toMatch(/phone/);
    // The tool result told the model what was wrong.
    const toolMsg = llm.calls[1].messages.find((m) => m.role === "tool")!;
    expect(toolMsg.content).toMatch(/phone/);
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
    expect(s.appointment.reason).toBe("Cleaning");
  });
});
