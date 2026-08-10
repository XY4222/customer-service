import { NextRequest, NextResponse } from "next/server";
import { readLLMConfig, getSecretStatus, LLMProviderId, writeLLMConfig } from "@/lib/llm-config";
import { applyConfigToRuntime, getProviderStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";

const VALID: LLMProviderId[] = ["coze", "openai-compatible", "classroom-fixture"];

/**
 * 进程内热切换 provider（同时落盘 data/llm-config.json）
 * POST /api/llm-config/switch { provider: "coze" | "openai-compatible" | "classroom-fixture" }
 *
 * 关键：
 *   - 只动内存覆写（_runtimeProviderOverride / _runtimeModelOverride）和 data 文件
 *   - 不接收、不存储任何明文密钥
 *   - 不污染 process.env（避免覆盖部署平台显式设置）
 *   - 若目标 provider 需要 API Key 但环境变量未配置，仍允许切换（业务调用时会失败，便于排查）
 */
export async function POST(req: NextRequest) {
  let body: { provider?: LLMProviderId };
  try {
    body = (await req.json()) as { provider?: LLMProviderId };
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }
  const p = body.provider;
  if (!p || !VALID.includes(p)) {
    return NextResponse.json({ error: `provider 必须是 ${VALID.join(" / ")} 之一` }, { status: 400 });
  }

  // 落盘
  const cfg = await readLLMConfig();
  cfg.activeProvider = p;
  cfg.updatedAt = new Date().toISOString();
  await writeLLMConfig(cfg);

  // 热切换：把 activeProvider + 该 provider 的 defaultModel 一起注入运行时
  // 用户主动切换时不自动降级（allowDegrade=false）：尊重用户选择，缺凭证则在调用时报错，便于排查
  const applyResult = applyConfigToRuntime(cfg, { allowDegrade: false });

  const status = getProviderStatus();
  const secret = getSecretStatus(cfg.providers[p]);

  return NextResponse.json({
    ok: true,
    provider: p,
    runtime: status,
    secret,
    apply: applyResult,
    note: secret.ready
      ? "已生效。后续 LLM 调用将走该 provider 与默认模型。"
      : `已切换，但检测到缺失环境变量：${secret.missing.join(", ")}。调用时会失败，请先在部署平台环境变量或 .env.local 中配置。`,
  });
}

/** 清除运行时覆写，回到 env 决定（但已落盘的 activeProvider 仍存在，重启会重新读它） */
export async function DELETE() {
  applyConfigToRuntime(null);
  return NextResponse.json({ ok: true, runtime: getProviderStatus() });
}
