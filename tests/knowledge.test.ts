import { describe, expect, it } from "vitest";
import { kb } from "./helpers";

const top = (q: string) => kb().search(q, 3);
const text = (q: string) => top(q).map((h) => h.text).join(" ");

describe("knowledge retrieval", () => {
  it("loads chunks from the knowledge folder", () => {
    expect(kb().size).toBeGreaterThan(20);
  });
  it("finds Invisalign", () => {
    expect(top("Do you offer Invisalign?")[0].source).toBe("orthodontics");
  });
  it("finds dental implants", () => {
    expect(["implants", "services"]).toContain(top("Do you do dental implants?")[0].source);
  });
  it("finds both office locations", () => {
    const t = text("Where are you located?");
    expect(t).toContain("257-10 Union Turnpike");
    expect(t).toContain("87-34 Parsons");
  });
  it("finds insurance and payment info", () => {
    expect(text("Do you accept insurance?")).toMatch(/most insurance plans/i);
    expect(text("What payment methods do you take?")).toMatch(/CareCredit/);
  });
  it("finds sedation", () => {
    expect(top("I'm scared of the dentist, do you have sedation?")[0].source).toBe("sedation");
  });
  it("finds hours and doctors", () => {
    expect(text("What are your hours?")).toMatch(/10:30/);
    expect(text("Who are your doctors?")).toMatch(/Kavi/);
  });
  it("finds the services overview", () => {
    expect(top("What services do you offer?")[0].heading).toMatch(/Services/);
  });
  it("returns nothing for unrelated questions", () => {
    expect(top("What is the capital of France?")).toHaveLength(0);
  });
});
