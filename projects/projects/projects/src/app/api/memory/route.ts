import { NextResponse } from "next/server";
import { listProfiles } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/memory — 所有访客画像列表（管理端） */
export async function GET() {
  const profiles = await listProfiles();
  return NextResponse.json({
    total: profiles.length,
    profiles: profiles.map((p) => ({
      visitorId: p.visitorId,
      interactionCount: p.interactionCount,
      isNewUser: p.isNewUser,
      factCount: p.facts.length,
      episodeCount: p.episodes.length,
      updatedAt: p.updatedAt,
      facts: p.facts.slice(0, 10),
      lastEpisode: p.episodes[0]?.summary ?? null,
    })),
  });
}
