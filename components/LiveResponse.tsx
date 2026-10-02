/** Right-hand live view of the receptionist's reply: fills in word by word while it is generated. */
export function LiveResponse({ text, streaming, active }: { text: string; streaming: boolean; active: boolean }) {
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Live response</h2>
        {streaming ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            Generating
          </span>
        ) : (
          <span className="text-xs text-slate-400">{active ? "Ready" : "Idle"}</span>
        )}
      </div>
      <p className="mt-3 min-h-[3.5rem] text-[15px] leading-snug text-slate-800" aria-live="polite">
        {text ? (
          <>
            {text}
            {streaming && <span className="ml-0.5 inline-block animate-pulse text-brand-600">▍</span>}
          </>
        ) : (
          <span className="text-slate-300">The receptionist&rsquo;s reply appears here as it is generated.</span>
        )}
      </p>
    </aside>
  );
}
