import { NextRequest } from "next/server";
import { executeTool, TOOLS, type ToolId } from "@/lib/tools";
import { listToolConfigs } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const configs = await listToolConfigs();
  const cfg = configs.find((c) => c.id === id);
  if (!cfg) return Response.json({ error: "Tool not found" }, { status: 404 });
  if (!cfg.enabled) return Response.json({ error: "Tool is disabled" }, { status: 400 });

  const meta = TOOLS.find((t) => t.id === id);
  const body = (await request.json().catch(() => ({}))) as { input?: Record<string, unknown> };
  const input = body.input ?? {};

  const start = Date.now();
  try {
    if (cfg.implementation === "mcp") {
      return Response.json({
        success: true,
        tool: { id, name: cfg.name, implementation: "mcp" },
        input,
        output: { _note: "MCP Tool 调用预留（沙箱环境未接入真实 MCP Server）" },
        durationMs: 0,
      });
    }
    if (!meta) return Response.json({ error: "Tool meta missing" }, { status: 500 });
    const output = await executeTool(id as ToolId, input);
    return Response.json({
      success: true,
      tool: { id: meta.id, name: meta.name, implementation: "local" },
      input,
      output,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    return Response.json(
      {
        success: false,
        tool: { id, name: cfg.name },
        input,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
