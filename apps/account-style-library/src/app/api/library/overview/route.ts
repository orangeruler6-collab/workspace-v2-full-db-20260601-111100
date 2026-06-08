import { NextResponse } from "next/server";
import { getLibraryOverview } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const includeHeavy = new URL(request.url).searchParams.get("includeHeavy") === "1";
    return NextResponse.json(await getLibraryOverview({ includeHeavy }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取风格库概览失败" },
      { status: 500 }
    );
  }
}
