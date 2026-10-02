import { z } from "zod";
import { isAdminRequest, unauthorized } from "@/lib/adminAuth";
import {
  STATUSES,
  deleteAppointmentRequest,
  getAppointmentRequest,
  getTranscriptForRequest,
  updateAppointmentStatus,
} from "@/lib/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const n = Number((await ctx.params).id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request, ctx: Ctx) {
  if (!isAdminRequest(req)) return unauthorized();
  const id = await parseId(ctx);
  const request = id ? await getAppointmentRequest(id) : undefined;
  if (!id || !request) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ request, transcript: await getTranscriptForRequest(id) });
}

const PatchBody = z.object({ status: z.enum(STATUSES) });

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAdminRequest(req)) return unauthorized();
  const id = await parseId(ctx);
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!id || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const updated = await updateAppointmentStatus(id, body.data.status);
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ request: updated });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!isAdminRequest(req)) return unauthorized();
  const id = await parseId(ctx);
  if (!id || !(await deleteAppointmentRequest(id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
