import { isAdminRequest, unauthorized } from "@/lib/adminAuth";
import { listAppointmentRequests } from "@/lib/appointments";
import { env } from "@/lib/config";
import { ensureDemoAppointmentRequest } from "@/lib/demoAppointment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return unauthorized();
  const url = new URL(req.url);
  try {
    if (!env.isProd()) await ensureDemoAppointmentRequest();
    const requests = await listAppointmentRequests({
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    return Response.json({ requests });
  } catch {
    return Response.json({ error: "Please try again in a moment." }, { status: 500 });
  }
}
