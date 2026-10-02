import type { AppointmentSnapshot } from "@/types";

const LABELS: [keyof AppointmentSnapshot["fields"], string][] = [
  ["full_name", "Full name"],
  ["address", "Address"],
  ["phone", "Phone number"],
  ["preferred_date", "Preferred date"],
  ["reason", "Reason for visit"],
];

export function AppointmentPanel({
  state,
  savedId,
}: {
  state: AppointmentSnapshot | null;
  savedId: number | null;
}) {
  const booking = state?.booking ?? false;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Appointment request</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            savedId && !booking
              ? "bg-emerald-100 text-emerald-700"
              : booking
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {savedId && !booking ? `Request #${savedId} saved` : booking ? "Collecting details" : "Not started"}
        </span>
      </div>
      <dl className="mt-4 space-y-2.5">
        {LABELS.map(([key, label]) => {
          const v = state?.fields[key];
          return (
            <div key={key} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${v ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="truncate text-slate-800">{v ?? "—"}</dd>
              </div>
            </div>
          );
        })}
        {state?.location && (
          <div className="text-xs text-slate-500">Preferred office: {state.location}</div>
        )}
      </dl>
      <p className="mt-4 text-xs text-slate-400">
        This is a request only. The office will contact the patient to schedule.
      </p>
    </div>
  );
}
