import { NextResponse } from "next/server";
import { getLLMRuntimeInfo, getRuntimeFallbackInfo } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    llm: getLLMRuntimeInfo(),
    fallback: getRuntimeFallbackInfo(),
  });
}
