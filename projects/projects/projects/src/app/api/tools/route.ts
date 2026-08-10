import { NextRequest, NextResponse } from "next/server";
import { listToolConfigs, updateToolConfig, listMcpServers, saveMcpServer } from "@/lib/store";
import { TOOLS } from "@/lib/tools";

export const runtime = "nodejs";

/**
 * meta.parameters 有两种形态：
 * - 旧形态: Record<string,string>，例如 { keyword: "string? 关键词" }
 * - 数组形态: { name, type, description, required?, default? }[]
 * 统一转成前端要的 { name, description, required, type?, default? }[]
 */
function normalizeParameters(
  params: unknown,
): { name: string; description: string; required: boolean; type?: string; default?: unknown }[] {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((p) => ({
      name: p.name,
      description: p.description ?? "",
      required: !!p.required,
      type: p.type,
      default: p.default,
    }));
  }
  if (typeof params === "object") {
    return Object.entries(params as Record<string, string>).map(([name, raw]) => {
      // 解析形如 "string? 关键词" / "number[]? 口味，默认5" / "boolean 是否新客"
      const str = String(raw ?? "").trim();
      const m = str.match(/^([a-zA-Z_][\w\[\]]*)(\?)?\s*(.*)$/);
      let type = "string";
      let required = false;
      let description = str;
      if (m) {
        type = m[1] || "string";
        required = m[2] !== "?";
        description = m[3] || str;
      }
      return { name, type, required, description };
    });
  }
  return [];
}

export async function GET() {
  const configs = await listToolConfigs();
  const toolsWithMeta = configs.map((c) => {
    const meta = TOOLS.find((t) => t.id === c.id);
    return {
      ...c,
      parameters: normalizeParameters(meta?.parameters),
      demoInput: meta?.demoInput ?? {},
      builtin: !!meta,
    };
  });
  const mcpServers = await listMcpServers();
  return NextResponse.json({ tools: toolsWithMeta, mcpServers });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const updated = await updateToolConfig(id, patch);
  if (!updated) return NextResponse.json({ error: "tool not found" }, { status: 404 });
  return NextResponse.json({ tool: updated });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (body.action === "connect_mcp") {
    // 预留：连接 MCP Server，实际调用会在后续接入
    const srv = {
      id: `mcp_${Date.now()}`,
      name: body.name || "New MCP Server",
      url: body.url,
      enabled: true,
      connectedAt: new Date().toISOString(),
      tools: body.tools || [],
    };
    await saveMcpServer(srv);
    return NextResponse.json({ server: srv });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
