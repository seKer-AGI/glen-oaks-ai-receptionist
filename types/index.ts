export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "hearing"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export interface TranscriptLine {
  id: number;
  role: "patient" | "receptionist";
  text: string;
}

export interface AppointmentSnapshot {
  booking: boolean;
  fields: {
    full_name: string | null;
    address: string | null;
    phone: string | null;
    preferred_date: string | null;
    reason: string | null;
  };
  location: string | null;
  savedIds: number[];
}
