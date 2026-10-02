"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AppointmentRequest, Status, TranscriptEntry } from "@/lib/appointments-types";

const STATUSES: Status[] = ["new", "contacted", "completed", "cancelled"];
const BADGE: Record<Status, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
};

type Detail = { request: AppointmentRequest; transcript: TranscriptEntry[] | null };

export function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<AppointmentRequest[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/requests?${params}`);
    if (res.status === 401) return setAuthed(false);
    if (!res.ok) return setError("Please try again in a moment.");
    setError(null);
    setAuthed(true);
    setRows((await res.json()).requests);
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function open(id: number) {
    const res = await fetch(`/api/admin/requests/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function setRowStatus(id: number, s: Status) {
    const res = await fetch(`/api/admin/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    if (res.ok) {
      const { request } = await res.json();
      setRows((r) => r.map((x) => (x.id === id ? request : x)));
      setDetail((d) => (d && d.request.id === id ? { ...d, request } : d));
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this appointment request permanently?")) return;
    const res = await fetch(`/api/admin/requests/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRows((r) => r.filter((x) => x.id !== id));
      setDetail(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
  }

  if (authed === null) return <main className="p-10 text-slate-400">Loading…</main>;
  if (!authed) return <Login onDone={load} />;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Appointment requests</h1>
          <p className="text-sm text-slate-500">Glen Oaks Dental Professionals · AI receptionist</p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/" className="text-slate-500 underline">Receptionist</Link>
          <button onClick={logout} className="text-slate-500 underline">Log out</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, address, reason…"
          className="w-72 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          Refresh
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {["Patient", "Phone", "Address", "Preferred date", "Reason", "Office", "Status", "Created", ""].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No appointment requests found.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{r.full_name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.phone}</td>
                <td className="max-w-[180px] truncate px-4 py-3">{r.address}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.preferred_date}</td>
                <td className="max-w-[200px] truncate px-4 py-3">{r.reason}</td>
                <td className="px-4 py-3">{r.location ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <button onClick={() => open(r.id)} className="mr-3 text-brand-700 hover:underline">View</button>
                  <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Request #{detail.request.id}</h2>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              {([
                ["Patient", detail.request.full_name],
                ["Phone", detail.request.phone],
                ["Address", detail.request.address],
                ["Preferred date", detail.request.preferred_date],
                ["Reason", detail.request.reason],
                ["Office", detail.request.location ?? "Not specified"],
                ["Created", new Date(detail.request.created_at).toLocaleString()],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            <label className="mt-4 block text-xs text-slate-500">
              Status
              <select
                value={detail.request.status}
                onChange={(e) => setRowStatus(detail.request.id, e.target.value as Status)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {detail.transcript && (
              <div className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Call transcript</h3>
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 text-sm">
                  {detail.transcript.map((t, i) => (
                    <p key={i}>
                      <span className="font-semibold">{t.role === "patient" ? "Patient" : "Receptionist"}:</span> {t.text}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => remove(detail.request.id)} className="mt-5 text-sm text-red-600 hover:underline">
              Delete request
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) onDone();
    else setErr((await res.json().catch(() => ({}))).error ?? "Login failed");
  }
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Admin login</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button className="mt-4 w-full rounded-lg bg-brand-600 py-2 font-medium text-white hover:bg-brand-700">Sign in</button>
      </form>
    </main>
  );
}
