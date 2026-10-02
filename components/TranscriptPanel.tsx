"use client";

import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/types";

export function TranscriptPanel({ lines }: { lines: TranscriptLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  return (
    <div className="flex h-[420px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
        Live transcript
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {lines.length === 0 && (
          <p className="text-sm text-slate-400">The conversation will appear here once the call starts.</p>
        )}
        {lines.map((l) => (
          <div key={l.id}>
            <div
              className={`text-[11px] font-semibold tracking-wider ${
                l.role === "patient" ? "text-slate-500" : "text-brand-600"
              }`}
            >
              {l.role === "patient" ? "PATIENT" : "AI RECEPTIONIST"}
            </div>
            <p className="mt-0.5 text-[15px] leading-snug text-slate-800">&ldquo;{l.text}&rdquo;</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
