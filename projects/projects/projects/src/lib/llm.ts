/**
 * 多 Provider LLM 层
 *
 * 通过环境变量 LLM_PROVIDER 选择：
 *   - "coze"（默认）: coze-coding-dev-sdk（沙箱凭证）
 *   - "openai-compatible": OPENAI_API_KEY / OPENAI_BASE_URL / LLM_MODEL
 *   - "classroom-fixture": 演示稳定模式，确定性输出，不依赖外部凭证
 *
 * 任何 provider 初始化/调用失败都会返回清晰中文错误，不 mock 成正常通过。
 */

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import type { LLMConfig, LLMProviderId } from "./llm-config";

export type LLMProvider = LLMProviderId;

/**
 * 启动/切换时记录降级原因（比如 OPENAI_API_KEY 未配置导致自动切到 classroom-fixture），
 * 供前端 Banner 明确告知"为什么当前在演示模式"。
 *
 * 同步落盘到 data/runtime-fallback.json（供下次启动参考），同时在同进程内保留内存缓存。
 * API Route 侧使用 getRuntimeFallbackInfo() 会**实时**根据 llm-config.json 与当前 env 重新判定，
 * 避免 Next.js production 下 server.ts bootstrap 与 API handler 跨进程导致状态丢失。
 */
const FALLBACK_FILE = path.join(process.cwd(), "data", "runtime-fallback.json");

interface FallbackState {
  requested: LLMProvider | null;
  reason: string | null;
  degraded: boolean;
}

let _runtimeFallbackCache: FallbackState | null = null;

function persistFallbackSync(state: FallbackState): void {
  _runtimeFallbackCache = state;
  try {
    fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // 写入失败不阻塞主流程
  }
}

/**
 * 实时计算降级状态：读 data/llm-config.json 的 activeProvider，对照当前环境变量是否就绪，
 * 判断当前是否处于自动降级到 classroom-fixture。
 * 这样不管 bootstrap 和 API Route 是否在同一进程，都能准确得出结论。
 */
export function getRuntimeFallbackInfo(): {
  requested: LLMProvider | null;
  actual: LLMProvider;
  reason: string | null;
  degraded: boolean;
} {
  const actual = getProvider();
  let requested: LLMProvider | null = null;
  let reason: string | null = null;
  let degraded = false;
  try {
    const p = path.join(process.cwd(), "data", "llm-config.json");
    const cfgRaw = fs.readFileSync(p, "utf-8");
    const cfg = JSON.parse(cfgRaw) as { activeProvider?: LLMProvider };
    const want = cfg.activeProvider;
    if (want && want !== "classroom-fixture" && KNOWN_PROVIDERS.includes(want)) {
      const ready = isProviderReady(want);
      if (!ready.ready && actual !== want) {
        requested = want;
        reason = ready.reason || "未就绪";
        degraded = true;
        // 顺手同步缓存与文件
        persistFallbackSync({ requested, reason, degraded: true });
      }
    }
  } catch {
    // 读不到配置文件就算了，不展示降级
  }
  return { requested, actual, reason, degraded };
}

let _runtimeProviderOverride: LLMProvider | null = null;
let _runtimeModelOverride: string | null = null;

export function setRuntimeProvider(p: LLMProvider | null) {
  _runtimeProviderOverride = p;
  if (p === null) _runtimeModelOverride = null;
}

export function getRuntimeProviderOverride(): LLMProvider | null {
  return _runtimeProviderOverride;
}

export function setRuntimeModel(m: string | null) {
  _runtimeModelOverride = m && m.trim() ? m.trim() : null;
}

export function getRuntimeModelOverride(): string | null {
  return _runtimeModelOverride;
}

/**
 * 进程内 provider 覆写（来自 /api/llm-config/switch 或 data/llm-config.json 启动时加载）
 * 默认 null，回退到 process.env.LLM_PROVIDER。
 */
export function getProvider(): LLMProvider {
  if (_runtimeProviderOverride) return _runtimeProviderOverride;
  const p = (process.env.LLM_PROVIDER || "coze").toLowerCase();
  if (p === "openai" || p === "openai_compatible" || p === "openai-compatible") return "openai-compatible";
  if (p === "fixture" || p === "classroom" || p === "classroom-fixture") return "classroom-fixture";
  return "coze";
}

const KNOWN_PROVIDERS: LLMProvider[] = ["coze", "openai-compatible", "classroom-fixture"];

/**
 * 判断一个 provider 当前运行环境下是否"就绪"（凭证/依赖可用）。
 * 仅用于启动/切换时做自动降级决策，不影响用户显式切换。
 */
export function isProviderReady(p: LLMProvider): { ready: boolean; reason?: string } {
  if (p === "classroom-fixture") return { ready: true };
  if (p === "openai-compatible") {
    if (!process.env.OPENAI_API_KEY) {
      return { ready: false, reason: "未配置环境变量 OPENAI_API_KEY" };
    }
    return { ready: true };
  }
  if (p === "coze") {
    try {
      // 用 require.resolve 试探性判断 SDK 是否可用（不实际加载）
      require.resolve("coze-coding-dev-sdk");
      return { ready: true };
    } catch {
      return { ready: false, reason: "当前环境无 coze-coding-dev-sdk 沙箱凭证" };
    }
  }
  return { ready: false, reason: `未知 provider: ${p}` };
}

/**
 * 把 data/llm-config.json 的"声明"应用到进程内运行时。
 *
 * 设计：data 文件是"模型管理页"控制的来源 → 总是应用。
 *   - 同时同步到 process.env.LLM_PROVIDER / LLM_MODEL（让 Next.js dev 模式 worker 也读得到）
 *   - 同时设 _runtimeProviderOverride / _runtimeModelOverride 作为 fast path
 *   - 校验：activeProvider 必须在 KNOWN_PROVIDERS 内才生效
 *   - 关键：若目标 provider 未就绪（比如没配 API Key），自动降级到 classroom-fixture 并记录原因，
 *          保证部署环境在零配置下也能打开页面/跑通演示链路，而不是启动后所有 LLM 调用直接 500。
 *   - 注意：会覆写 process.env.LLM_PROVIDER / LLM_MODEL；若想"锁"某个 provider，
 *           应该编辑 data/llm-config.json，或配置好对应环境变量后重启。
 */
export function applyConfigToRuntime(config: LLMConfig | null | undefined, opts?: {
  /** 默认 true：目标 provider 未就绪时自动降级到 classroom-fixture；
   *  false 时（用户在模型管理页主动切换）尊重用户选择，不降级，调用失败时再报错 */
  allowDegrade?: boolean;
}): {
  applied: boolean;
  reason?: string;
  provider?: LLMProvider;
  model?: string | null;
  degraded?: boolean;
  requestedProvider?: LLMProvider;
} {
  const allowDegrade = opts?.allowDegrade !== false;
  if (!config) {
    persistFallbackSync({ requested: null, reason: null, degraded: false });
    return { applied: false, reason: "no config" };
  }
  const requested = config.activeProvider;
  if (!KNOWN_PROVIDERS.includes(requested)) {
    return { applied: false, reason: `unknown provider: ${requested}` };
  }
  const pConfig = config.providers?.[requested];
  const modelFromConfig = pConfig?.defaultModel?.trim() || null;

  // 就绪性检查：不就绪则降级到 classroom-fixture（仅 allowDegrade=true 时）
  const readiness = isProviderReady(requested);
  let effective: LLMProvider = requested;
  let degraded = false;
  let reason: string | undefined;
  if (!readiness.ready && allowDegrade && requested !== "classroom-fixture") {
    effective = "classroom-fixture";
    degraded = true;
    reason = `${requested} 未就绪（${readiness.reason}），已自动切到演示稳定模式`;
    persistFallbackSync({ requested, reason: readiness.reason || "未就绪", degraded: true });
  } else if (readiness.ready) {
    persistFallbackSync({ requested: null, reason: null, degraded: false });
  } else {
    // 用户主动切到一个未就绪的 provider（allowDegrade=false）：不记录降级，
    // 让前端看到真实的 provider 名，调用失败时再按错误提示处理
    persistFallbackSync({ requested: null, reason: null, degraded: false });
  }

  // 同步 process.env（让 Next.js dev worker 也读得到）
  process.env.LLM_PROVIDER = effective;
  if (effective !== "classroom-fixture" && modelFromConfig) {
    process.env.LLM_MODEL = modelFromConfig;
  } else if (effective === "classroom-fixture") {
    process.env.LLM_MODEL = "fixture-v1";
  }

  // 同步内存覆写（fast path）
  setRuntimeProvider(effective);
  setRuntimeModel(effective === "classroom-fixture" ? "fixture-v1" : modelFromConfig);
  return {
    applied: true,
    provider: effective,
    requestedProvider: requested,
    model: effective === "classroom-fixture" ? "fixture-v1" : modelFromConfig,
    degraded,
    reason,
  };
}

/** 异步版本：启动时调。先读 data 文件，再 apply。失败不抛，退回 env。 */
export async function loadAndApplyConfigFromDisk(): Promise<{
  applied: boolean;
  reason?: string;
  provider?: LLMProvider;
  model?: string | null;
  configPath?: string;
  degraded?: boolean;
  requestedProvider?: LLMProvider;
}> {
  try {
    const configPath = path.join(process.cwd(), "data", "llm-config.json");
    const raw = await fsp.readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as LLMConfig;
    const result = applyConfigToRuntime(config);
    return { ...result, configPath };
  } catch (err: any) {
    return { applied: false, reason: `load failed: ${err?.message || String(err)}` };
  }
}

export interface CallLLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  userPrompt: string;
  /** 若为 true，优先请求模型严格输出 JSON（OpenAI 兼容协议使用 response_format=json_object） */
  jsonMode?: boolean;
}

export interface ProviderStatus {
  provider: LLMProvider;
  label: string;
  description: string;
  isFixture: boolean;
  model: string;
}

let _cozedClient: any = null;

export function getProviderStatus(): ProviderStatus {
  const p = getProvider();
  if (p === "classroom-fixture") {
    return {
      provider: p,
      label: "演示稳定模式",
      description: "使用内置确定性输出，无需 API Key，适合演示与回路测试；非真实大模型。",
      isFixture: true,
      model: "fixture-v1",
    };
  }
  if (p === "openai-compatible") {
    return {
      provider: p,
      label: "OpenAI 兼容模型",
      description: `使用 ${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}`,
      isFixture: false,
      model: _runtimeModelOverride || process.env.LLM_MODEL || "gpt-4o-mini",
    };
  }
  return {
    provider: p,
    label: "扣子豆包（Doubao）",
    description: "通过 coze-coding-dev-sdk 调用，需要沙箱凭证。",
    isFixture: false,
    model: _runtimeModelOverride || process.env.LLM_MODEL || "doubao-seed-1-8-251228",
  };
}

export function isFixtureMode(): boolean {
  return getProvider() === "classroom-fixture";
}

function buildMessages(opts: CallLLMOptions) {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.userPrompt });
  return messages;
}

async function callCoze(opts: CallLLMOptions, request?: Request): Promise<string> {
  let LLMClient: any, Config: any, HeaderUtils: any;
  try {
    const sdk = await import("coze-coding-dev-sdk");
    LLMClient = sdk.LLMClient;
    Config = sdk.Config;
    HeaderUtils = sdk.HeaderUtils;
  } catch (e: any) {
    throw new Error(
      "当前 LLM_PROVIDER=coze，但 coze-coding-dev-sdk 不可用。请确认运行在扣子沙箱中，或设置 LLM_PROVIDER=openai-compatible 并配置 OPENAI_API_KEY/OPENAI_BASE_URL，或设置 LLM_PROVIDER=classroom-fixture 切换到演示稳定模式。"
    );
  }
  if (!_cozedClient) {
    const config = new Config();
    const customHeaders = request ? HeaderUtils.extractForwardHeaders(request.headers) : undefined;
    _cozedClient = new LLMClient(config, customHeaders);
  }
  const resp = await _cozedClient.invoke(buildMessages(opts), {
    model: opts.model ?? process.env.LLM_MODEL ?? "doubao-seed-1-8-251228",
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens,
  });
  const txt = resp?.content;
  if (typeof txt !== "string" || !txt.trim()) {
    throw new Error("模型返回为空，请检查模型配置或稍后重试。");
  }
  return txt;
}

async function callOpenAICompatible(opts: CallLLMOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "当前 LLM_PROVIDER=openai-compatible，但缺少 OPENAI_API_KEY。请设置环境变量，或切换 LLM_PROVIDER=classroom-fixture 到演示稳定模式。"
    );
  }
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini";

  // 识别 reasoning 模型：
  // - 名称含 reasoning / r1 / think / o1 / o3 / o4 等显式推理标识
  // - DeepSeek v4-pro（标签 "(reasoning)"，思考过程消耗大量 token）
  // - Kimi k2-thinking 类后缀
  const isReasoningModel = /reasoning|(?:^|[^a-z])r1(?:[^a-z]|$)|deepseek-r|think|kimi.*k2-?\d*thinking|deepseek-v\d+-pro(?!-flash)|o[1-4](?:-|$)/i.test(model);
  // reasoning 模型思考过程会占用 max_tokens，必须预留足够空间给正式输出
  const effectiveMaxTokens = isReasoningModel
    ? Math.max(opts.maxTokens ?? 0, 8192)
    : (opts.maxTokens ?? 2048);
  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.7,
    max_tokens: effectiveMaxTokens,
  };
  // reasoning 模型通常不支持 response_format=json_object，交给 prompt 引导 JSON 输出
  if (opts.jsonMode && !isReasoningModel) {
    body.response_format = { type: "json_object" };
    // json_object 模式下必须在 messages 里提到 "json" 关键字，某些模型会报错；加一层保护
    if (opts.systemPrompt && !/json/i.test(opts.systemPrompt)) {
      body.messages = buildMessages({
        ...opts,
        systemPrompt: (opts.systemPrompt || "") + "\n\n请严格输出合法 JSON，不要输出额外解释或 Markdown 代码块标记。",
      });
    }
  } else if (opts.jsonMode && isReasoningModel) {
    // reasoning 模型降级为 prompt 引导 JSON
    body.messages = buildMessages({
      ...opts,
      systemPrompt: (opts.systemPrompt || "") + "\n\n请严格输出合法 JSON，不要输出额外解释、思考过程复述或 Markdown 代码块标记，仅输出纯 JSON 对象。",
    });
  }
  // DeepSeek reasoning 模型需要通过 extra body 控制 reasoning 长度，low 可让思考 token 最少
  if (isReasoningModel && /deepseek/i.test(model)) {
    (body as Record<string, unknown>).reasoning_effort = "low";
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI 兼容接口调用失败（HTTP ${resp.status}）：${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  // 兼容 reasoning 模型：DeepSeek V3 Pro 等 reasoning 模型可能把主内容放在 message.reasoning_content + message.content，
  // 或 content 是 null/空字符串时由 reasoning_effort 控制
  let txt = data?.choices?.[0]?.message?.content;
  if ((typeof txt !== "string" || !txt.trim()) && data?.choices?.[0]?.message?.reasoning_content) {
    // 部分兼容层会把最终回复放到 reasoning_content 后面，这里做兜底
    txt = (data.choices[0].message as Record<string, unknown>).content as string;
  }
  // 如果 content 仍是空但 finish_reason 存在，检查是否有 tool_calls
  const msg = data?.choices?.[0]?.message;
  if (typeof txt !== "string" || !txt.trim()) {
    const cm = (c: unknown) => {
      const m = (c as Record<string, Record<string, unknown>> | undefined)?.message;
      return {
        role: m?.role,
        content: m?.content,
        reasoning_content: m?.reasoning_content,
        has_tool_calls: Array.isArray(m?.tool_calls),
      };
    };
    console.error("[openai-compatible] unexpected empty content, raw response (truncated):",
      JSON.stringify({
        id: data?.id,
        model: data?.model,
        choices: data?.choices?.map((c: unknown) => ({
          finish_reason: (c as Record<string, unknown>)?.finish_reason,
          message: cm(c),
        })),
        error: data?.error,
      }).slice(0, 1500));
    throw new Error(`OpenAI兼容接口返回为空。finish_reason=${data?.choices?.[0]?.finish_reason ?? "unknown"}，请确认模型是否支持 response_format=json_object 或是否为 reasoning 模型。`);
  }
  return txt;
}

/**
 * 演示稳定模式：根据 userPrompt 中出现的关键词启发式返回结构化结果，
 * 覆盖 need-extraction / product-recommendation / response-generator / risk-check / reason-writer
 * 等核心 Skill 所需的固定输出形态，保证 Eval 闭环可完整跑通，但不冒充真实模型。
 */
async function callClassroomFixture(opts: CallLLMOptions): Promise<string> {
  const sys = opts.systemPrompt || "";
  const sysLower = sys.toLowerCase();
  const q = opts.userPrompt;

  // 优先从 SKILL.md 的 frontmatter 中提取 skill id（最准确），避免关键字互相干扰
  const idMatch = sys.match(/^---[\s\S]*?^id:\s*([a-zA-Z0-9_-]+)\s*$/m);
  const skillId = idMatch ? idMatch[1].toLowerCase() : "";

  // 判定当前是哪个 Skill：优先用 skill id，其次再用关键字兜底
  const isPlanner = skillId === "planner" || /planner|生成计划|plan|步骤/i.test(sys) && !skillId;
  const isRisk = skillId === "risk-check" || /风控|risk|合规|审核/i.test(sysLower) && !skillId;
  const isRequirement = skillId === "need-extraction" || /need-extraction|需求结构化|intent.*提取/i.test(sys);
  const isRecommend = skillId === "recommendation-decision" || /recommendation-decision|商品推荐决策|selectedProductIds/i.test(sys);
  const isReason = skillId === "recommendation-reason" || /recommendation-reason|推荐理由生成|sellingPoints/i.test(sys);
  const isScript = skillId === "response-generator" || /response-generator|生成客服回复|生成.*话术/i.test(sys);

  if (isPlanner) {
    return JSON.stringify({
      reasoning: "演示稳定模式默认计划",
      steps: [
        { id: "s1", type: "skill", ref: "need-extraction", description: "需求结构化" },
        { id: "s2", type: "tool", ref: "query_products", description: "查询商品" },
        { id: "s3", type: "tool", ref: "query_activities", description: "查询活动" },
        { id: "s4", type: "tool", ref: "query_coupons", description: "查询优惠券" },
        { id: "s5", type: "skill", ref: "product-recommendation", description: "推荐决策" },
        { id: "s6", type: "tool", ref: "calculate_price", description: "价格计算" },
        { id: "s7", type: "skill", ref: "reason-writer", description: "卖点理由" },
        { id: "s8", type: "skill", ref: "response-generator", description: "生成话术" },
        { id: "s9", type: "skill", ref: "risk-check", description: "风控审核" },
      ],
    });
  }

  if (isRisk) {
    const forbidden = ["绝对", "100%", "包治", "根治", "特效", "国家级", "永久", "包退", "包赔", "保证"];
    const tightened = process.env.FIXTURE_RISK_TIGHTENED === "1";
    const hit = forbidden.filter((w) => q.includes(w));
    const issues: Array<{ type: string; detail: string; severity: string }> = [];
    if (hit.length) issues.push({ type: "禁词", detail: `包含禁词：${hit.join("、")}`, severity: "blocker" });
    if (/一定.*(好|满意|退)|不满意.*(退|赔)/.test(q)) issues.push({ type: "过度承诺", detail: "包含不好吃包退/一定满意等过度承诺", severity: "blocker" });
    if (tightened && /价格.*(错|假)|不是这个价/.test(q)) issues.push({ type: "价格不符", detail: "价格与计算结果不一致", severity: "blocker" });
    // 参数缺失兜底
    if (/参数缺失|缺少.*参数|补充.*参数/.test(q)) {
      issues.push({ type: "参数缺失", detail: "必要参数缺失，无法审核", severity: "blocker" });
    }
    const passed = issues.length === 0;
    return JSON.stringify({
      passed,
      riskLevel: passed ? "low" : "high",
      issues,
      suggestedFix: passed ? "" : "请根据 issues 调整回复内容，确保合规。",
    });
  }

  if (isRequirement) {
    const budgetMatch = q.match(/(\d+)\s*元/);
    const budgetNum = budgetMatch ? parseInt(budgetMatch[1], 10) : 50;
    const categories: string[] = [];
    const flavorTags: string[] = [];
    if (/辣|麻辣/.test(q)) { categories.push("肉制品"); flavorTags.push("麻辣"); }
    else if (/甜|饼干|糖|蛋糕|曲奇/.test(q)) categories.push("饼干糕点");
    else if (/坚果|腰果|巴旦木|核桃/.test(q)) categories.push("坚果");
    else if (/薯片|膨化|海苔/.test(q)) categories.push("膨化食品");
    else if (/办公室|上班/.test(q)) categories.push("膨化食品");
    if (categories.length === 0) categories.push("膨化食品");
    const isNew = /新客|第一次|新人|首次/.test(q);
    const isGift = /送礼|礼物|送人|送女朋友|送男友|送女|送男|礼盒/.test(q);
    const keywords: string[] = [];
    if (/辣|麻辣/.test(q)) keywords.push("麻辣");
    if (/坚果/.test(q)) keywords.push("坚果");
    if (/办公室|上班/.test(q)) keywords.push("办公室");
    if (/礼盒|送礼|送女|送男/.test(q)) keywords.push("礼盒");
    if (keywords.length === 0) keywords.push("零食");
    return JSON.stringify({
      intent: isGift ? "gift" : "browse",
      categories,
      flavorTags,
      budget: { min: 0, max: budgetNum },
      scenario: /办公室|上班/.test(q) ? "office" : (isGift ? "gift" : "home"),
      isNewUser: isNew,
      isGift,
      needsClarification: false,
      allergyConcerns: [],
      afterSalesType: null,
      orderId: null,
      urgency: "low",
      sentiment: "neutral",
      keywords,
    });
  }

  if (isRecommend) {
    // 从传入的 products 里挑前 2 个 id（fallback 两个内置 prod id）
    let ids: string[] = [];
    // 优先匹配 products: [...] 块
    const productBlockMatch = q.match(/products:\s*(\[[\s\S]*?\])(?:\n|$)/i);
    if (productBlockMatch) {
      try {
        const arr = JSON.parse(productBlockMatch[1]);
        ids = arr.slice(0, 3).map((p: any) => p.id).filter(Boolean);
      } catch { /* ignore */ }
    }
    // 兜底：匹配 selectedIds 字段
    if (ids.length === 0) {
      const selMatch = q.match(/selectedIds:\s*([^\n]*)/i);
      if (selMatch && selMatch[1] && selMatch[1].trim() && selMatch[1].trim() !== '""' && selMatch[1].trim() !== "''") {
        const raw = selMatch[1].trim().replace(/^["']|["']$/g, "");
        ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
      }
    }
    if (ids.length === 0) ids = ["prod_spicy_stick", "prod_nuts_pack"];
    // isGift 场景优先标记礼盒思路
    const isGiftQ = /送礼|礼盒|送女|送男|礼物/.test(q);
    return JSON.stringify({
      selectedProductIds: ids.slice(0, 3),
      reasoning: isGiftQ ? "送礼场景优先挑选合适礼盒/包装商品，匹配预算" : "匹配口味与预算",
      needsClarification: false,
      clarificationQuestion: null,
    });
  }

  if (isReason) {
    // 从输入的 products 中提取真实 id 和 name，为每个商品生成卖点
    let products: Array<{ id?: string; name?: string; tags?: string[]; description?: string }> = [];
    const pm = q.match(/products:\s*(\[[\s\S]*?\])(?:\n|$)/i);
    if (pm) {
      try { products = JSON.parse(pm[1]); } catch { /* ignore */ }
    }
    const items = products.slice(0, 3).map((p) => {
      const name = p.name || p.id || "零食";
      const tagDesc = (p.tags && p.tags.length) ? p.tags.slice(0, 2).join("、") : "";
      return {
        productId: p.id || "",
        sellingPoints: [
          `${name}，${tagDesc ? `${tagDesc}风味，` : ""}独立小包装方便分次食用`,
          /办公室|上班/.test(q) ? "适合办公室下午茶或加班分享" : "日常解馋、分享都合适",
        ],
        scenarioMatch: /送|礼盒|礼物/.test(q)
          ? `适合送礼场景，包装精美拿得出手`
          : /办公室|上班/.test(q)
            ? "办公室场景下小包装不易脏手，方便随时解馋"
            : "口感和分量都很合适，日常解馋正好",
      };
    });
    if (items.length === 0) {
      items.push(
        { productId: "prod_spicy_stick", sellingPoints: ["经典麻辣口味，独立小包方便解馋", "适合办公室下午茶或加班分享"], scenarioMatch: "麻辣口味契合用户偏好，小包装方便分次食用" },
        { productId: "prod_nuts_pack", sellingPoints: ["每日坚果组合，营养健康", "独立小袋适合办公分享"], scenarioMatch: "办公室场景下坚果类健康且不易脏手" },
      );
    }
    return JSON.stringify({ items });
  }

  if (isScript) {
    // 从 price.finalPrice 读取合计价；否则回退到用户提到的数字
    let finalPrice = "";
    const finalM = q.match(/finalPrice["':\s]+([0-9.]+)/i);
    if (finalM) finalPrice = finalM[1];
    if (!finalPrice) {
      const budgetMatch = q.match(/(\d+)\s*元/);
      finalPrice = budgetMatch ? budgetMatch[1] : "29.9";
    }
    // 提取商品名
    let products: Array<{ name?: string; id?: string }> = [];
    const pm = q.match(/products:\s*(\[[\s\S]*?\])(?:\n|$)/i);
    if (pm) {
      try { products = JSON.parse(pm[1]); } catch { /* ignore */ }
    }
    // 提取 reasons/sellingPoints
    let sellingPointText = "";
    const reasonsM = q.match(/reasons:\s*([\s\S]*?)(?:\n[a-zA-Z_]+:|$)/i);
    if (reasonsM) sellingPointText = reasonsM[1].slice(0, 200);
    const nameLine = products.slice(0, 3).map((p) => p.name || p.id).filter(Boolean).join("、");
    const isGiftQ = /送|礼盒|礼物|女朋友|男朋友/.test(q);
    const isOfficeQ = /办公室|上班/.test(q);
    let reply: string;
    if (isGiftQ) {
      reply = `您好呀，${nameLine ? `为您挑选了${nameLine}` : "为您准备了几款合适的礼盒"}，作为礼物${nameLine ? "包装" : ""}精致好看也体面，搭配下来到手约 ${finalPrice} 元。最近新客还有专享优惠券可以叠加，特别划算。如果想换其他口味或价位的，随时告诉我帮您调整~`;
    } else if (isOfficeQ) {
      reply = `您好，办公室解闷的话，麻辣口味的小零嘴最是过瘾。${nameLine ? `为您挑了${nameLine}` : "为您挑了两款"}，搭配下来到手约 ${finalPrice} 元，都是独立小包装，吃起来不脏手也方便分享。最近店里还有满减和品类折扣，可以一起凑单更划算。还有其他口味想试试的话随时告诉我~`;
    } else {
      reply = `您好，${nameLine ? `为您挑了${nameLine}` : "为您选了两款热销零食"}，搭配到手约 ${finalPrice} 元，都是口碑不错的款，独立小包装吃起来方便。如果还有其他口味偏好或预算需求，随时告诉我哈~`;
    }
    return JSON.stringify({ reply });
  }

  // Fallback: 安全通用回复
  return "您好，已经为您记录需求，稍后会给您推荐合适商品~";
}

// 硬编码在 SKILL.md 中的 doubao/coze 模型名集合。命中这些名字时，
// 在 openai-compatible 模式下会回退到 env LLM_MODEL，否则会 400。
const COZE_FAMILY_MODEL_RE = /^(doubao|seed-|coze[_-])/i;

/** 供 UI 层展示"实际会跑的模型名"：把豆包/扣子系列模型名在 openai-compatible 下翻译成 env LLM_MODEL */
export function getEffectiveModelForDisplay(requested: string | undefined): { effective: string; translated: boolean; requested?: string } {
  const p = getProvider();
  const envModel = process.env.LLM_MODEL;
  const fallback = (envModel && envModel.length > 0) ? envModel : "gpt-4o-mini";
  if (!requested) return { effective: fallback, translated: false };
  if (p !== "openai-compatible") return { effective: requested, translated: false };
  if (!COZE_FAMILY_MODEL_RE.test(requested)) return { effective: requested, translated: false };
  return { effective: fallback, translated: true, requested };
}

function pickModelForProvider(p: LLMProviderId, requested: string | undefined): string {
  return getEffectiveModelForDisplay(requested).effective;
}

export async function callLLM(opts: CallLLMOptions, request?: Request): Promise<string> {
  const p = getProvider();
  const resolvedOpts: CallLLMOptions = { ...opts, model: pickModelForProvider(p, opts.model) };
  try {
    if (p === "openai-compatible") return await callOpenAICompatible(resolvedOpts);
    if (p === "classroom-fixture") return await callClassroomFixture(resolvedOpts);
    return await callCoze(resolvedOpts, request);
  } catch (e: any) {
    // 模型错误必须显式抛出，不吞、不伪造"质量 FAIL"
    const tag = `[LLM:${p}]`;
    const msg = e?.message ? `${tag} ${e.message}` : `${tag} 调用失败`;
    const err = new Error(msg);
    (err as any).provider = p;
    (err as any).original = e;
    throw err;
  }
}

/** 同步返回当前 provider 信息，供页面展示"运行模式"徽标。 */
export function getLLMRuntimeInfo(): ProviderStatus {
  return getProviderStatus();
}

// Default model (for skills that don't specify)
export const DEFAULT_MODEL = getProviderStatus().model;
