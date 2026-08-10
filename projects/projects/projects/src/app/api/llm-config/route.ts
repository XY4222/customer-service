import { NextRequest, NextResponse } from "next/server";
import { readLLMConfig, updateLLMConfig, getSecretStatus, LLMConfigUpdate, LLMProviderId } from "@/lib/llm-config";
import { applyConfigToRuntime, getProviderStatus, getRuntimeProviderOverride, getRuntimeFallbackInfo } from "@/lib/llm";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS: LLMProviderId[] = ["coze", "openai-compatible", "classroom-fixture"];

export async function GET() {
  const config = await readLLMConfig();
  const runtime = getProviderStatus();
  const runtimeOverride = getRuntimeProviderOverride();
  const secrets: Record<string, ReturnType<typeof getSecretStatus>> = {};
  for (const id of VALID_PROVIDERS) {
    secrets[id] = getSecretStatus(config.providers[id]);
  }
  return NextResponse.json({
    config,
    runtime,
    runtimeOverride,
    fallback: getRuntimeFallbackInfo(),
    /** 便捷：当前 runtime 与 config.activeProvider 是否一致（不考虑启动期自动降级的情况） */
    runtimeMatchesConfig: runtimeOverride
      ? runtimeOverride === config.activeProvider
      : runtime.provider === config.activeProvider,
    secrets,
  });
}

export async function PUT(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }

  // 安全：拒绝任何 forbidden key 出现在请求体任意嵌套层级
  const FORBIDDEN_KEYS = [
    "apiKey", "api_key", "apikey", "key", "secret", "token",
    "password", "authorization", "openaiApiKey", "openai_api_key",
  ];
  const findForbidden = (obj: any, path = ""): string | null => {
    if (obj === null || typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.includes(k)) return path ? `${path}.${k}` : k;
      const v = obj[k];
      if (v && typeof v === "object") {
        const r = findForbidden(v, path ? `${path}.${k}` : k);
        if (r) return r;
      }
    }
    return null;
  };
  const forbiddenPath = findForbidden(body);
  if (forbiddenPath) {
    return NextResponse.json(
      { error: `检测到禁止字段：${forbiddenPath}。请只配置环境变量名，不要提交明文密钥。` },
      { status: 400 }
    );
  }

  try {
    const next = await updateLLMConfig(body as LLMConfigUpdate);
    // 让新配置立即影响运行时：activeProvider + 该 provider 的 defaultModel
    // 用户在模型管理页主动保存时不自动降级（allowDegrade=false），缺凭证就显式报错
    const applyResult = applyConfigToRuntime(next, { allowDegrade: false });
    return NextResponse.json({ config: next, ok: true, apply: applyResult });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "更新失败" }, { status: 400 });
  }
}
