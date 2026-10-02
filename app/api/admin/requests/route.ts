import { isAdminRequest, unauthorized } from "@/lib/adminAuth";
import { listAppointmentRequests } from "@/lib/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return unauthorized();
  const url = new URL(req.url);
  try {
    const requests = await listAppointmentRequests({
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    return Response.json({ requests });
  } catch {
    return Response.json({ error: "Please try again in a moment." }, { status: 500 });
  }
}
