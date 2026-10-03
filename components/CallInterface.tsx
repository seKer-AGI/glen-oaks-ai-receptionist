"use client";

import { useVoiceCall } from "@/hooks/useVoiceCall";
import type { CallStatus } from "@/types";
import { AppointmentPanel } from "./AppointmentPanel";
import { WaveformBars } from "./WaveformBars";

const STATUS_HEADLINE: Record<CallStatus, string> = {
  idle: "Ready to take your call",
  connecting: "Connecting…",
  listening: "Listening…",
  hearing: "Hearing you…",
  thinking: "One moment…",
  speaking: "Receptionist speaking",
  ended: "Call ended",
  error: "Call could not start",
};

const STATUS_SUBLINE: Record<CallStatus, string> = {
  idle: "Tap below to speak with the receptionist.",
  connecting: "Setting up your call…",
  listening: "You can speak whenever you're ready.",
  hearing: "I'm listening…",
  thinking: "Please hold for a moment.",
  speaking: "The receptionist is responding.",
  ended: "Start a new call to speak with the receptionist.",
  error: "Check your microphone and try again.",
};

export function CallInterface() {
  const { status, error, appointment, startCall, endCall } = useVoiceCall();
  const active = ["connecting", "listening", "hearing", "thinking", "speaking"].includes(status);

  const startLabel = status === "ended" || status === "error" ? "Start New Call" : "Start Call";

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
      <section className="flex min-h-[420px] flex-col rounded-[28px] bg-app-surface px-8 py-10 shadow-card sm:px-12">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <WaveformBars active={active} />

          <p className="mt-8 text-xl font-semibold text-app-text" role="status">
            {active ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-app-accent" />
                {STATUS_HEADLINE[status]}
              </span>
            ) : (
              STATUS_HEADLINE[status]
            )}
          </p>

          <p className="mt-2 max-w-sm text-sm text-app-muted">
            {error ? error : STATUS_SUBLINE[status]}
          </p>
        </div>

        <div className="mt-8">
          {active ? (
            <button
              type="button"
              onClick={endCall}
              className="w-full rounded-full border border-app-danger/40 bg-transparent py-4 text-base font-semibold text-app-danger transition hover:bg-app-danger/10 focus:outline-none focus:ring-2 focus:ring-app-danger/40"
            >
              End Call
            </button>
          ) : (
            <button
              type="button"
              onClick={startCall}
              className="w-full rounded-full bg-app-accent py-4 text-base font-semibold text-app-accent-fg transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-app-accent/50"
            >
              {startLabel}
            </button>
          )}
        </div>

        {error && active && (
          <p role="alert" className="mt-4 text-center text-sm text-app-danger">
            {error}
          </p>
        )}
      </section>

      <AppointmentPanel state={appointment} />
    </div>
  );
}
