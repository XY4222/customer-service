import { NextResponse } from "next/server";
import { listEnabledSkills } from "@/lib/skills-registry";
import { getToolCatalog } from "@/lib/tools";
import { listToolConfigs } from "@/lib/store";
import { readPlannerConfig, generatePlan } from "@/lib/planner";

export const dynamic = "force-dynamic";

// 预览 Planner：拼好的 Prompt + 生成计划
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question }: { question?: string } = body;

    const skills = listEnabledSkills();
    // 工具列表必须与 generatePlan 一致：启停以 tools-config.json 为准，
    // 否则预览会把被禁用的工具（如 reserve_stock）显示成可用
    const toolConfigs = await listToolConfigs();
    const enabledToolIds = new Set(toolConfigs.filter((t) => t.enabled).map((t) => t.id));
    const tools = getToolCatalog().filter((t) => enabledToolIds.has(t.id));
    const cfg = readPlannerConfig();

    let generatedPlan = null;
    if (question) {
      generatedPlan = await generatePlan({ question, history: [] });
    }

    // Prompt 预览（简单展示）
    const basePrompt = `${cfg.systemPrompt}\n\n【可用 Skills】\n${skills.map((s) => `- [skill] ${s.id}: ${s.name}`).join("\n")}\n\n【可用 Tools】\n${tools.map((t) => `- [tool] ${t.id}: ${t.name}`).join("\n")}`;

    return NextResponse.json({
      summary: {
        enabledSkills: skills.length,
        enabledTools: tools.length,
        mandatorySkills: cfg.mandatorySkills,
        basicTools: cfg.basicTools,
        priceTools: cfg.priceTools,
        riskEnabled: skills.some((s) => s.id === "risk-check" && s.enabled),
      },
      skillList: skills.map((s) => ({ id: s.id, name: s.name })),
      toolList: tools.map((t) => ({ id: t.id, name: t.name })),
      basePrompt,
      plan: generatedPlan,
      question: question ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
