import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteSelectedText } from "@/lib/ai";

export const runtime = "nodejs";

const schema = z.object({
  fullText: z.string().min(1),
  selectedText: z.string().min(1),
  instruction: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await rewriteSelectedText(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "局部改写失败" },
      { status: 400 }
    );
  }
}
