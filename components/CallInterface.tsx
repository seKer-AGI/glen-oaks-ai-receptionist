"use client";

import { useVoiceCall } from "@/hooks/useVoiceCall";
import type { CallStatus } from "@/types";
import { AppointmentPanel } from "./AppointmentPanel";
import { LiveResponse } from "./LiveResponse";
import { TranscriptPanel } from "./TranscriptPanel";

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: "Ready to take your call",
  connecting: "Connecting…",
  listening: "Listening…",
  hearing: "Hearing you…",
  thinking: "One moment…",
  speaking: "Receptionist speaking",
  ended: "Call ended",
  error: "Call could not start",
};

export function CallInterface() {
  const { status, transcript, error, appointment, liveText, liveStreaming, startCall, endCall } = useVoiceCall();
  const active = ["connecting", "listening", "hearing", "thinking", "speaking"].includes(status);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div
            className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${
              active ? "bg-brand-500 text-white" : "bg-brand-100 text-brand-700"
            } ${status === "listening" || status === "hearing" ? "animate-pulse" : ""}`}
            aria-hidden
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </div>

          <div className="mt-5 h-6 text-sm font-medium text-slate-600" role="status">
            {active ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                Call in progress · {STATUS_TEXT[status]}
              </span>
            ) : (
              STATUS_TEXT[status]
            )}
          </div>

          <div className="mt-5">
            {active ? (
              <button
                onClick={endCall}
                className="rounded-full bg-red-600 px-8 py-3 font-semibold text-white shadow hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                End Call
              </button>
            ) : (
              <button
                onClick={startCall}
                className="rounded-full bg-brand-600 px-8 py-3 font-semibold text-white shadow hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {status === "ended" || status === "error" ? "Start New Call" : "Start Call"}
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {!active && status === "idle" && (
            <p className="mx-auto mt-4 max-w-md text-xs text-slate-400">
              Your browser will ask for microphone access. Try: &ldquo;What services do you offer?&rdquo; or
              &ldquo;I&rsquo;d like to book an appointment.&rdquo;
            </p>
          )}
        </div>

        <TranscriptPanel lines={transcript} />
      </div>

      <div className="space-y-6 lg:sticky lg:top-6 lg:h-fit">
        <LiveResponse text={liveText} streaming={liveStreaming} active={active} />
        <AppointmentPanel state={appointment} />
      </div>
    </div>
  );
}
