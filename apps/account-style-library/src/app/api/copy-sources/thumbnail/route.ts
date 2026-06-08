import { NextResponse } from "next/server";
import { getCopySourceThumbnailFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("sourceId") || "";
    if (!sourceId) throw new Error("缺少素材 ID");
    const file = await getCopySourceThumbnailFile(sourceId);
    return new Response(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取素材截图失败" },
      { status: 400 }
    );
  }
}
