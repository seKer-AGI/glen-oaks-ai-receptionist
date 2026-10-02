import Link from "next/link";
import { CallInterface } from "@/components/CallInterface";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">AI Dental Receptionist</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Glen Oaks Dental Professionals</h1>
          <p className="mt-2 text-slate-500">
            Talk to our receptionist about services, locations, or request an appointment.
          </p>
        </div>
        <Link href="/admin" className="shrink-0 text-sm text-slate-500 underline hover:text-slate-800">
          Admin
        </Link>
      </header>
      <CallInterface />
      <footer className="mt-10 text-center text-xs text-slate-400">
        Demo. The AI receptionist does not give medical advice. For urgent concerns call the office directly.
      </footer>
    </main>
  );
}
