import { NextRequest, NextResponse } from "next/server";
import { readLLMConfig, LLMProviderId } from "@/lib/llm-config";
import { callLLM, getProviderStatus, setRuntimeProvider } from "@/lib/llm";

export const dynamic = "force-dynamic";

const VALID: LLMProviderId[] = ["coze", "openai-compatible", "classroom-fixture"];

/**
 * 连通性测试：
 *   POST /api/llm-config/test { provider?, model? }
 *   - provider 不传：用 data/llm-config.json 的 activeProvider
 *   - 同时在内存中临时切到目标 provider（不影响 config 落盘），调完恢复
 *   - 返回 { ok, latencyMs, preview, error?, runtime }
 */
export async function POST(req: NextRequest) {
  let body: { provider?: LLMProviderId; model?: string } = {};
  try {
    body = (await req.json()) as { provider?: LLMProviderId; model?: string };
  } catch {
    body = {};
  }
  const cfg = await readLLMConfig();
  const target: LLMProviderId = (body.provider && VALID.includes(body.provider))
    ? body.provider
    : cfg.activeProvider;
  const targetProvider = cfg.providers[target];
  const model = body.model || targetProvider.defaultModel;

  // 临时切到目标 provider
  const { getRuntimeProviderOverride } = await import("@/lib/llm");
  const previous = getRuntimeProviderOverride();
  setRuntimeProvider(target);

  const t0 = Date.now();
  let preview = "";
  try {
    preview = await callLLM({
      model,
      temperature: 0,
      // 测试连接也要保证 reasoning 模型有足够 token 输出（避免"测试通但业务空"的假象）
      maxTokens: /reasoning|r1|deepseek-r|think/i.test(model) ? 4096 : 64,
      systemPrompt: "你是一个连通性测试助手。请用中文在 20 字以内回应。",
      userPrompt: "你好，测试连接。请回复：连接正常。",
    });
    return NextResponse.json({
      ok: true,
      provider: target,
      model,
      latencyMs: Date.now() - t0,
      preview: preview.slice(0, 200),
      runtime: getProviderStatus(),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      provider: target,
      model,
      latencyMs: Date.now() - t0,
      error: e?.message || String(e),
      runtime: getProviderStatus(),
    }, { status: 200 }); // 测试失败本身用 ok:false 表达，不让 5xx 干扰 UI
  } finally {
    // 恢复
    setRuntimeProvider(previous);
  }
}
