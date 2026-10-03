import Link from "next/link";
import { CallInterface } from "@/components/CallInterface";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="min-h-screen bg-app-bg px-4 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <Link
            href="/admin"
            className="text-sm font-medium text-app-muted transition hover:text-app-text"
          >
            Admin
          </Link>
        </div>

        <header className="mx-auto mt-14 max-w-2xl text-center sm:mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-app-accent">AI Dental Receptionist</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-app-text sm:text-4xl">
            Glen Oaks Dental Professionals
          </h1>
          <p className="mt-4 text-base leading-relaxed text-app-muted sm:text-lg">
            Talk to our receptionist about services, locations, or request an appointment.
          </p>
        </header>

        <div className="mt-12 sm:mt-14">
          <CallInterface />
        </div>
      </div>
    </main>
  );
}
