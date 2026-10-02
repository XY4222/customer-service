/**
 * 长期记忆库（Profile Memory）
 *
 * 设计：
 * - 每个访客一个画像文件：data/memory/profiles/<visitorId>.json
 * - 画像 = 稳定事实（口味偏好/忌口/身份标签/预算习惯）+ 交互轨迹摘要
 * - 写入全部走原子写（fs-atomic），遵守项目持久化红线
 * - 提取用 LLM 增量合并；fixture 模式下用规则兜底（保证课堂演示可跑）
 * - 隐私红线：手机号/证件号/门牌地址在落盘与送模型前统一脱敏；带脱敏标记的文本
 *   不会再成为「稳定事实」（详见 redactPII）
 * - visitorId 走白名单：[A-Za-z0-9_-]{1,64} 且排除 Windows 保留设备名（con/nul/com1…）；
 *   非法 id 一律视为「无记忆的访客」，避免写入撞设备名而静默失败
 */
import { promises as fs } from "fs";
import path from "path";
import { atomicWriteText } from "./fs-atomic";
import { callLLM } from "./llm";

const MEMORY_DIR = path.join(process.cwd(), "data", "memory");
const PROFILES_DIR = path.join(MEMORY_DIR, "profiles");

// ---------- Types ----------

export interface MemoryFact {
  /** 稳定事实：口味偏好、忌口、身份标签、预算习惯等 */
  kind: "preference" | "restriction" | "identity" | "budget" | "scenario" | "other";
  content: string;
  /** 事实来源的 runId */
  sourceRunId?: string;
  updatedAt: string;
}

export interface MemoryEpisode {
  /** 一次交互的摘要（一句到两句） */
  runId: string;
  question: string;
  summary: string;
  /** 交互中提到/推荐的商品 */
  products?: string[];
  ts: string;
}

export interface VisitorProfile {
  visitorId: string;
  createdAt: string;
  updatedAt: string;
  /** 新客身份：首次交互 true；产生订单/复购后可翻转（由提取器判定） */
  isNewUser: boolean;
  /** 交互次数 */
  interactionCount: number;
  /** 稳定事实（去重后，最多 30 条） */
  facts: MemoryFact[];
  /** 轨迹摘要（最多保留 20 条，新的在前） */
  episodes: MemoryEpisode[];
}

export function emptyProfile(visitorId: string): VisitorProfile {
  return {
    visitorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isNewUser: true,
    interactionCount: 0,
    facts: [],
    episodes: [],
  };
}

const FACT_KINDS: MemoryFact["kind"][] = ["preference", "restriction", "identity", "budget", "scenario", "other"];

/** kind 白名单校验：模型可能返回自造分类，一律落到 other */
export function normalizeKind(raw: unknown): MemoryFact["kind"] {
  return typeof raw === "string" && (FACT_KINDS as string[]).includes(raw) ? (raw as MemoryFact["kind"]) : "other";
}

// ---------- File R/W (atomic) ----------

const VISITOR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Windows 保留设备名不能作为文件名，即使带扩展名（con.json 会写到设备而不是文件） */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 清洗 visitorId：白名单校验（防目录穿越 + 防 Windows 设备名 + 限长）；非法返回空串 */
export function sanitizeVisitorId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!VISITOR_ID_RE.test(trimmed)) return "";
  if (WINDOWS_RESERVED_NAME.test(trimmed)) return "";
  return trimmed;
}

/** visitorId → 画像文件绝对路径；非法 id 返回 null（调用方按「无此访客」处理） */
function profilePath(visitorId: string): string | null {
  const safe = sanitizeVisitorId(visitorId);
  if (!safe) return null;
  return path.join(PROFILES_DIR, `${safe}.json`);
}

/** 画像文件可能被外部编辑过：补齐缺失字段，避免 /memory 页与召回链路直接抛错 */
export function normalizeProfile(raw: unknown, visitorId: string): VisitorProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<VisitorProfile>;
  const now = new Date().toISOString();
  const facts: MemoryFact[] = Array.isArray(p.facts)
    ? p.facts
        .filter((f) => f && typeof f.content === "string")
        .map((f) => ({
          kind: normalizeKind(f.kind),
          content: f.content,
          sourceRunId: typeof f.sourceRunId === "string" ? f.sourceRunId : undefined,
          updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : now,
        }))
    : [];
  const episodes: MemoryEpisode[] = Array.isArray(p.episodes)
    ? p.episodes.filter((e) => e && typeof e.summary === "string" && typeof e.ts === "string")
    : [];
  return {
    visitorId: typeof p.visitorId === "string" && p.visitorId ? p.visitorId : visitorId,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : now,
    isNewUser: p.isNewUser !== false,
    interactionCount:
      typeof p.interactionCount === "number" && Number.isFinite(p.interactionCount) ? p.interactionCount : 0,
    facts,
    episodes,
  };
}

export async function readProfile(visitorId: string): Promise<VisitorProfile | null> {
  const file = profilePath(visitorId);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf-8");
    return normalizeProfile(JSON.parse(raw), visitorId);
  } catch {
    return null;
  }
}

export async function writeProfile(p: VisitorProfile): Promise<void> {
  const file = profilePath(p.visitorId);
  if (!file) throw new Error(`[memory] 非法 visitorId，拒绝写入画像：${p.visitorId}`);
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  p.updatedAt = new Date().toISOString();
  await atomicWriteText(file, JSON.stringify(p, null, 2));
}

export async function listProfiles(): Promise<VisitorProfile[]> {
  try {
    const files = await fs.readdir(PROFILES_DIR);
    const out: VisitorProfile[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(PROFILES_DIR, f), "utf-8");
        const profile = normalizeProfile(JSON.parse(raw), f.replace(/\.json$/, ""));
        if (profile) out.push(profile);
      } catch {
        /* skip broken file */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

// ---------- 隐私脱敏 ----------

const REDACTION_MARKS = [
  "[手机号已脱敏]",
  "[电话已脱敏]",
  "[证件号已脱敏]",
  "[长数字已脱敏]",
  "[地址已脱敏]",
  "[门牌已脱敏]",
];

/**
 * 敏感信息脱敏（红线：不存手机号/地址等个人信息）。
 * 覆盖手机号、座机、身份证号、13-19 位长数字串、含省市路号的地址、楼栋门牌；
 * 只替换「明确识别到」的模式，不做模糊猜测，避免误伤正常业务文本。
 */
export function redactPII(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/\d{17}[\dXx]/g, "[证件号已脱敏]");
  out = out.replace(/\d{13,19}/g, "[长数字已脱敏]");
  out = out.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, "[手机号已脱敏]");
  out = out.replace(/0\d{2,3}[\s-]?\d{7,8}/g, "[电话已脱敏]");
  out = out.replace(
    /[\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:省|市|区|县|镇|乡|街道)[\u4e00-\u9fa5A-Za-z0-9]{0,12}(?:路|街|道|巷|弄|号|楼|栋|单元|室|座)[\u4e00-\u9fa5A-Za-z0-9]{0,20}/g,
    "[地址已脱敏]",
  );
  out = out.replace(/\d{1,4}(?:号楼|栋|单元|室)\d{0,4}/g, "[门牌已脱敏]");
  return out;
}

/** 文本是否触及过敏感信息：触及过的内容不再作为长期事实保存 */
export function containsRedaction(text: string): boolean {
  return REDACTION_MARKS.some((mark) => text.includes(mark));
}

// ---------- Recall：把画像压缩成注入 Planner/Executor 的上下文块 ----------

export function buildMemoryContext(p: VisitorProfile | null): string {
  if (!p) return "（该用户是新访客，暂无历史记忆）";
  const facts = p.facts ?? [];
  const episodes = p.episodes ?? [];
  const lines: string[] = [];
  lines.push(`- 交互次数：${p.interactionCount ?? 0} 次；身份：${p.isNewUser ? "新客" : "老客（已产生过购买/复购）"}`);
  if (facts.length > 0) {
    lines.push("- 稳定偏好与画像：");
    for (const f of facts.slice(0, 12)) lines.push(`  · [${f.kind}] ${f.content}`);
  }
  if (episodes.length > 0) {
    lines.push("- 近期交互摘要（新→旧）：");
    for (const e of episodes.slice(0, 6)) {
      lines.push(`  · ${e.ts.slice(0, 10)} ${e.summary}${e.products?.length ? `（提到：${e.products.join("、")}）` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------- Extraction：会话结束后提取记忆 ----------

export interface ExtractionInput {
  question: string;
  finalReply: string;
  needExtraction?: Record<string, unknown>; // step_1 结构化需求（可选）
  products?: string[]; // 本次推荐的商品名
}

const EXTRACT_SYSTEM_PROMPT = `你是客服系统的记忆提取器。从一次客服交互中提取值得长期记住的用户信息。

只提取「稳定、可复用」的信息，忽略一次性细节。分类：
- preference: 口味/品类偏好（爱吃辣、喜欢坚果、偏好无糖）
- restriction: 忌口/过敏/特殊约束（不吃香菜、花生过敏、孕妇、给小孩买）
- identity: 身份状态（新客、老客、复购过、办公室采购）
- budget: 预算习惯（常买 20-50 元、送礼愿花 100+）
- scenario: 常见使用场景（办公室下午茶、追剧、送礼）
- other: 其他值得记住的稳定信息

同时判断：这次交互是否表明用户「已购买/复购」（boughtSomething）。

严格输出 JSON（无值得记住的信息时输出空数组）：
{
  "newFacts": [{"kind": "preference", "content": "喜欢麻辣口味零食"}],
  "boughtSomething": false,
  "episodeSummary": "一句话概括这次交互（30字内）"
}`;

function extractJsonLoose(raw: string): any | null {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      return null;
    }
  }
  return null;
}

// ---------- 购买意图判定（决定新客 → 老客翻转） ----------

/** 明确的购买表述（不含"想买/囤货"这类意向：第一次逛店的人不是老客） */
const PURCHASE_RE = /(下单|已购|购买|买过|买了|再买|又买|回购|复购|续购|拍下|付款|支付)/;
/** 明确的复购/囤货表述：即使同时提到售后，也说明是老客在回购 */
const REPURCHASE_RE = /(复购|回购|再买|又买|续购|再囤|又来)/;
/** 售后/查单语境：不能当作「已购买」的证据（否则一句「订单号是多少」就把新客变老客） */
const AFTER_SALES_RE = /(订单号|订单状态|订单在|查订单|物流|快递|发货|到货|退回|退货|退款|售后|取消订单|发票|投诉)/;

/**
 * 本轮交互是否足以判定「已购买/复购」。
 * 明确复购表述优先；售后/查单语境一律不算；其余交给提取器（LLM 或规则）判断。
 */
function shouldFlipToOldUser(question: string, extractorSaysBought: boolean): boolean {
  if (REPURCHASE_RE.test(question)) return true;
  if (AFTER_SALES_RE.test(question)) return false;
  return extractorSaysBought;
}

/** 规则兜底用的关键词表：kind 与事实内容一一对应（不再靠内容反推分类） */
const KEYWORD_RULES: Array<{ re: RegExp; kind: MemoryFact["kind"]; content: string }> = [
  { re: /麻辣|香辣|辣/, kind: "preference", content: "偏好麻辣口味" },
  { re: /奶香|牛奶味/, kind: "preference", content: "偏好奶香口味" },
  { re: /无糖|低糖|0糖/, kind: "preference", content: "偏好无糖/低糖零食" },
  { re: /坚果|每日坚果/, kind: "preference", content: "常买坚果类" },
  { re: /巧克力/, kind: "preference", content: "喜欢巧克力" },
  { re: /儿童|小孩|孩子|宝宝/, kind: "restriction", content: "会给孩子买零食" },
  { re: /孕妇/, kind: "restriction", content: "孕期用户，需注意食品安全" },
  { re: /送礼|礼盒|送女朋友|送人/, kind: "scenario", content: "有送礼需求" },
  { re: /办公室/, kind: "scenario", content: "常在办公室场景吃零食" },
];

/** 过敏原抽取：优先「对X过敏」，其次「X过敏」；疑问/情态词（会不会过敏、是不是过敏）不算过敏原 */
const ALLERGEN_FILLER_RE = /(会不会|是不是|不会|否|不|没|容易|要|想|别|能|可|会)/;

function extractAllergen(question: string): string | undefined {
  const explicit = question.match(/对([\u4e00-\u9fa5A-Za-z0-9]{1,6})过敏/);
  if (explicit?.[1]) return explicit[1];
  const loose = question.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,4})过敏/);
  if (loose?.[1] && !ALLERGEN_FILLER_RE.test(loose[1])) return loose[1];
  return undefined;
}

/** 规则兜底提取（fixture 模式 / LLM 失败时）：至少保住口味词和商品轨迹 */
function ruleBasedExtract(input: ExtractionInput): {
  newFacts: Array<{ kind: MemoryFact["kind"]; content: string }>;
  boughtSomething: boolean;
  episodeSummary: string;
} {
  const facts: Array<{ kind: MemoryFact["kind"]; content: string }> = [];
  const q = redactPII(input.question);
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(q)) facts.push({ kind: rule.kind, content: rule.content });
  }
  // 过敏：抓到过敏原才写具体事实，抓不到就写「待确认」，不产出「过敏信息：过敏」这类残句
  const allergen = extractAllergen(q);
  if (allergen) {
    facts.push({ kind: "restriction", content: `对${allergen}过敏，需避开` });
  } else if (/过敏/.test(q)) {
    facts.push({ kind: "restriction", content: "有过敏史，推荐时需人工确认过敏原" });
  }
  const budgetMatch = q.match(/预算\s*(\d+)(?:\s*[-~到至]\s*(\d+))?\s*元/);
  if (budgetMatch) {
    facts.push({
      kind: "budget",
      content: budgetMatch[2] ? `预算范围 ${budgetMatch[1]}-${budgetMatch[2]} 元` : `预算约 ${budgetMatch[1]} 元左右`,
    });
  }
  const summary =
    input.products?.length
      ? `咨询后推荐了 ${input.products.slice(0, 3).join("、")}`
      : `咨询：${q.slice(0, 24)}${q.length > 24 ? "…" : ""}`;
  return {
    newFacts: facts.filter((f) => f.content),
    boughtSomething: shouldFlipToOldUser(q, PURCHASE_RE.test(q)),
    episodeSummary: summary.slice(0, 40),
  };
}

/** 归一化 LLM 提取结果：kind 白名单 + 长度上限 + 脱敏；含敏感信息的条目不采纳 */
export function normalizeExtractedFacts(
  raw: unknown,
): Array<{ kind: MemoryFact["kind"]; content: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ kind: MemoryFact["kind"]; content: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rawContent = (item as { content?: unknown }).content;
    const content = typeof rawContent === "string" ? rawContent.trim() : "";
    if (content.length < 2 || content.length > 60) continue;
    const redacted = redactPII(content);
    if (containsRedaction(redacted)) continue;
    out.push({ kind: normalizeKind((item as { kind?: unknown }).kind), content: redacted });
  }
  return out;
}

const PER_KIND_CAP = 8;
const TOTAL_CAP = 30;

/** 事实去重合并：内容相同（归一化后）不重复；同类最多 8 条，满额时淘汰该类最旧一条 */
function mergeFacts(
  existing: MemoryFact[],
  incoming: Array<{ kind: MemoryFact["kind"]; content: string }>,
  sourceRunId: string
): { merged: MemoryFact[]; added: number } {
  const norm = (s: string) => s.replace(/[\s，。,.]/g, "").toLowerCase();
  const out = [...existing];
  let added = 0;
  for (const f of incoming) {
    if (!f.content || f.content.length < 2) continue;
    if (containsRedaction(f.content)) continue;
    if (out.some((e) => norm(e.content) === norm(f.content))) continue;
    const sameKind = out.filter((e) => e.kind === f.kind);
    if (sameKind.length >= PER_KIND_CAP) {
      // 满额时淘汰同类中最早的一条，让新信息能被记住（而不是静默丢弃）
      const oldest = sameKind.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
      out.splice(out.indexOf(oldest), 1);
    }
    out.push({ kind: f.kind, content: f.content, sourceRunId, updatedAt: new Date().toISOString() });
    added++;
  }
  return { merged: out.slice(-TOTAL_CAP), added };
}

export interface MemoryUpdateResult {
  visitorId: string;
  addedFacts: number;
  boughtSomething: boolean;
  summary: string;
  usedFallback: boolean;
}

/**
 * 会话结束后调用：提取本次交互记忆并合并进画像。
 * 设计为 fire-and-forget 安全：任何失败都不抛出（记忆是增强，不是关键路径）。
 */
export async function updateMemoryAfterRun(params: {
  visitorId: string;
  runId: string;
  input: ExtractionInput;
}): Promise<MemoryUpdateResult | null> {
  const { visitorId, runId, input } = params;
  if (!visitorId) return null;
  // 送入模型与落盘前统一脱敏：原始文本不再外流到画像文件
  const safeQuestion = redactPII(input.question);
  const safeReply = redactPII(input.finalReply ?? "");
  try {
    const profile = (await readProfile(visitorId)) ?? emptyProfile(visitorId);
    profile.interactionCount += 1;

    let extracted: {
      newFacts: Array<{ kind: MemoryFact["kind"]; content: string }>;
      boughtSomething: boolean;
      episodeSummary: string;
    };
    let usedFallback = false;

    try {
      const raw = await callLLM({
        model: "doubao-seed-2-0-mini-260215",
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        userPrompt: `## 用户问题\n${safeQuestion}\n\n## 客服回复（节选）\n${safeReply.slice(0, 400)}\n\n## 结构化需求（如有）\n${input.needExtraction ? redactPII(JSON.stringify(input.needExtraction)).slice(0, 600) : "无"}\n\n## 本次推荐商品\n${input.products?.length ? input.products.join("、") : "无"}`,
        temperature: 0.1,
        maxTokens: 400,
        jsonMode: true,
      });
      const parsed = extractJsonLoose(raw);
      if (
        parsed &&
        Array.isArray(parsed.newFacts) &&
        typeof parsed.episodeSummary === "string"
      ) {
        extracted = {
          newFacts: normalizeExtractedFacts(parsed.newFacts).slice(0, 6),
          boughtSomething: !!parsed.boughtSomething,
          episodeSummary: parsed.episodeSummary.slice(0, 60),
        };
      } else {
        extracted = ruleBasedExtract(input);
        usedFallback = true;
      }
    } catch {
      extracted = ruleBasedExtract(input);
      usedFallback = true;
    }

    const { merged, added } = mergeFacts(profile.facts, extracted.newFacts, runId);
    profile.facts = merged;

    // 购买/复购 → 翻转新客身份；售后/查单语境不算购买证据
    if (shouldFlipToOldUser(safeQuestion, extracted.boughtSomething)) profile.isNewUser = false;

    profile.episodes.unshift({
      runId,
      question: safeQuestion.slice(0, 80),
      summary: redactPII(extracted.episodeSummary).slice(0, 60),
      products: input.products?.slice(0, 5),
      ts: new Date().toISOString(),
    });
    profile.episodes = profile.episodes.slice(0, 20);

    await writeProfile(profile);

    return {
      visitorId,
      addedFacts: added,
      boughtSomething: extracted.boughtSomething,
      summary: extracted.episodeSummary,
      usedFallback,
    };
  } catch (e) {
    console.warn("[memory] updateMemoryAfterRun failed:", (e as Error)?.message);
    return null;
  }
}

// ---------- Admin helpers ----------

/** 删除画像（被遗忘权）；非法 id 直接返回 false，不会触碰目录外文件 */
export async function deleteProfile(visitorId: string): Promise<boolean> {
  const file = profilePath(visitorId);
  if (!file) return false;
  try {
    await fs.rm(file);
    return true;
  } catch {
    return false;
  }
}
