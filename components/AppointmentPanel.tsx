import type { AppointmentSnapshot } from "@/types";

const LABELS: [keyof AppointmentSnapshot["fields"], string][] = [
  ["full_name", "Full name"],
  ["address", "Address"],
  ["phone", "Phone number"],
  ["preferred_date", "Preferred date"],
  ["reason", "Reason for visit"],
];

function FieldCheck({ filled }: { filled: boolean }) {
  if (!filled) {
    return <span className="mt-1 h-5 w-5 shrink-0 rounded-full border border-app-border bg-app-surface-elevated" />;
  }
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app-accent text-app-accent-fg">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M2.5 6l2.5 2.5L9.5 4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function AppointmentPanel({ state }: { state: AppointmentSnapshot | null }) {
  const booking = state?.booking ?? false;
  const savedId = state?.savedId ?? null;
  const done = !booking && savedId !== null;
  const filled = LABELS.filter(([k]) => state?.fields[k]).length;
  const progress = done ? 100 : (filled / 5) * 100;

  return (
    <aside className="flex min-h-[420px] flex-col rounded-[28px] bg-app-surface px-8 py-8 shadow-card sm:px-10">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-app-text">Appointment request</h2>
        <span className="shrink-0 rounded-full bg-app-accent px-3 py-1 text-xs font-semibold text-app-accent-fg">
          {filled} of 5 collected
        </span>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-app-accent-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-app-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <dl className="mt-8 flex-1 space-y-6">
        {LABELS.map(([key, label]) => {
          const v = state?.fields[key];
          return (
            <div key={key} className="flex items-start gap-3">
              <FieldCheck filled={Boolean(v)} />
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-app-muted">{label}</dt>
                <dd className={`mt-0.5 break-words text-[15px] leading-snug ${v ? "text-app-text" : "text-app-subtle"}`}>
                  {v ?? "—"}
                </dd>
              </div>
            </div>
          );
        })}
        {state?.location && (
          <div className="border-t border-app-border pt-4 text-xs text-app-muted">
            Preferred office: <span className="font-medium text-app-text">{state.location}</span>
          </div>
        )}
      </dl>

      <p className="mt-6 text-xs leading-relaxed text-app-subtle">
        {done
          ? `Request saved${savedId ? ` (#${savedId})` : ""}. The office will contact the patient to schedule.`
          : "This is a request only. The office will contact the patient to schedule."}
      </p>
    </aside>
  );
}
