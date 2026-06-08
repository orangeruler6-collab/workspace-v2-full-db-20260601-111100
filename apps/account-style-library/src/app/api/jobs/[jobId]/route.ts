import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    return NextResponse.json({ job: await getJob(jobId, ownerKeyFromRequest(request)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取任务失败" },
      { status: 404 }
    );
  }
}

function ownerKeyFromRequest(request: Request) {
  const clientId = request.headers.get("x-usagi-client-id") || "";
  const raw = request.headers.get("x-usagi-auth-user") || "";
  if (raw) {
    try {
      const user = JSON.parse(decodeURIComponent(raw)) as { id?: unknown; username?: unknown; display_name?: unknown; role?: unknown };
      const stable = user.id ?? user.username ?? user.display_name ?? "";
      if (stable) return `user:${String(stable)}`;
      if (user.role) return `role:${String(user.role)}:${clientId}`;
    } catch {}
  }
  return clientId ? `client:${clientId}` : "";
}
