import { createAppointmentRequest, listAppointmentRequests, saveTranscript } from "./appointments";

/** Sample request shown in the admin dashboard during local development. */
export const DEMO_APPOINTMENT_REQUEST = {
  full_name: "Moazzem",
  address: "Street 80, North Block, LA",
  phone: "+1-234-567-89",
  preferred_date: "2026-10-04",
  reason: "I just wanna have a checkup of my front tooth",
  location: "Jamaica" as const,
};

const DEMO_SESSION_ID = "demo-appointment-moazzem";

const DEMO_TRANSCRIPT = [
  { role: "patient" as const, text: "Hi, I'd like to request an appointment." },
  { role: "receptionist" as const, text: "Sure. What's your full name?" },
  { role: "patient" as const, text: "Moazzem." },
  { role: "receptionist" as const, text: "What's your address?" },
  { role: "patient" as const, text: "Street 80, North Block, LA." },
  { role: "receptionist" as const, text: "And your phone number?" },
  { role: "patient" as const, text: "Plus one, two three four, five six seven, eight nine." },
  { role: "receptionist" as const, text: "What date works for you?" },
  { role: "patient" as const, text: "October fourth, twenty twenty-six." },
  { role: "receptionist" as const, text: "What's the reason for your visit?" },
  { role: "patient" as const, text: "I just wanna have a checkup of my front tooth." },
];

/** Fixed "call day" so the preferred date still validates when seeding. */
const DEMO_CALL_TIME = new Date("2026-10-03T12:00:00Z");

export async function ensureDemoAppointmentRequest(): Promise<void> {
  const existing = await listAppointmentRequests({ q: DEMO_APPOINTMENT_REQUEST.full_name });
  if (existing.some((r) => r.phone === DEMO_APPOINTMENT_REQUEST.phone)) return;

  const request = await createAppointmentRequest(DEMO_APPOINTMENT_REQUEST, DEMO_CALL_TIME);
  await saveTranscript(DEMO_SESSION_ID, DEMO_CALL_TIME.toISOString(), DEMO_TRANSCRIPT, [request.id]);
}
