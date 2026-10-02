// Types shared by server and browser (no server-only imports here).
export const STATUSES = ["new", "contacted", "completed", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export interface AppointmentRequest {
  id: number;
  full_name: string;
  address: string;
  phone: string;
  preferred_date: string;
  reason: string;
  location: "Glen Oaks" | "Jamaica" | null;
  status: Status;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: "patient" | "receptionist";
  text: string;
  at: string;
}
