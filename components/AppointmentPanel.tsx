import type { AppointmentSnapshot } from "@/types";

const LABELS: [keyof AppointmentSnapshot["fields"], string][] = [
  ["full_name", "Full name"],
  ["address", "Address"],
  ["phone", "Phone number"],
  ["preferred_date", "Preferred date"],
  ["reason", "Reason for visit"],
];

export function AppointmentPanel({ state }: { state: AppointmentSnapshot | null }) {
  const booking = state?.booking ?? false;
  const savedId = state?.savedId ?? null;
  const done = !booking && savedId !== null;
  const filled = LABELS.filter(([k]) => state?.fields[k]).length;

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Appointment request</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            done
              ? "bg-emerald-100 text-emerald-700"
              : booking
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {done ? `Saved · #${savedId}` : booking ? `Collecting · ${filled}/5` : "Not started"}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className={`h-full rounded-full transition-all duration-300 ${done ? "bg-emerald-500" : "bg-brand-500"}`}
          style={{ width: `${done ? 100 : (filled / 5) * 100}%` }}
        />
      </div>

      <dl className="mt-4 space-y-3">
        {LABELS.map(([key, label]) => {
          const v = state?.fields[key];
          return (
            <div key={key} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${v ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className={`break-words ${v ? "text-slate-900" : "text-slate-300"}`}>{v ?? "—"}</dd>
              </div>
            </div>
          );
        })}
        {state?.location && (
          <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Preferred office: <span className="font-medium text-slate-700">{state.location}</span>
          </div>
        )}
      </dl>

      <p className="mt-4 text-xs leading-snug text-slate-400">
        {done
          ? "Request saved. The office will contact the patient to schedule."
          : "This is a request only. The office will contact the patient to schedule."}
      </p>
    </aside>
  );
}
