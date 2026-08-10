/**
 * 本地 JSON + SKILL.md 持久层
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const SKILLS_DIR = path.join(process.cwd(), "skills");

// ---------- Frontmatter Parser ----------
export interface SkillMeta {
  id: string;
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  requiredTools: string[];
  description?: string;
}
export interface SkillDoc {
  meta: SkillMeta;
  systemPrompt: string;
  filePath: string;
}

function parseFrontmatter(raw: string, id: string, filePath: string): SkillDoc {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return {
      meta: {
        id,
        name: id,
        model: "doubao-seed-2-0-mini-260215",
        temperature: 0.3,
        maxTokens: 800,
        enabled: true,
        requiredTools: [],
      },
      systemPrompt: raw.trim(),
      filePath,
    };
  }
  const fm = match[1];
  const body = match[2].trim();
  const meta: any = { id, requiredTools: [], enabled: true };
  fm.split("\n").forEach((line) => {
    const m = line.match(/^([\w]+):\s*(.*)$/);
    if (!m) return;
    const k = m[1];
    let v: any = m[2].trim();
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (!isNaN(Number(v)) && v !== "") v = Number(v);
    else if (v.startsWith("[") && v.endsWith("]")) {
      v = v
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    meta[k] = v;
  });
  const descMatch = body.match(/^#[^\n]*\n+([^\n]+)/);
  if (descMatch) meta.description = descMatch[1].trim();
  return { meta: meta as SkillMeta, systemPrompt: body, filePath };
}

function stringifyFrontmatter(doc: SkillDoc): string {
  const { meta } = doc;
  const fm = [
    `id: ${meta.id}`,
    `name: ${meta.name}`,
    `model: ${meta.model}`,
    `temperature: ${meta.temperature}`,
    `maxTokens: ${meta.maxTokens}`,
    `enabled: ${meta.enabled}`,
    `requiredTools: [${(meta.requiredTools || []).join(", ")}]`,
    meta.description ? `description: ${meta.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `---\n${fm}\n---\n\n${doc.systemPrompt}`;
}

// ---------- Generic JSON R/W with a process-level mutex ----------
// A tiny queue per filename prevents concurrent read-modify-write cycles
// (e.g. eval batch updates) from overwriting each other.
const fileQueues = new Map<string, Promise<unknown>>();
async function withFileLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileQueues.get(name) ?? Promise.resolve();
  let next!: (v: unknown) => void;
  const gate = new Promise<unknown>((res) => { next = res; });
  fileQueues.set(name, gate);
  try {
    await prev;
    return await fn();
  } finally {
    next(undefined);
    if (fileQueues.get(name) === gate) fileQueues.delete(name);
  }
}

async function readJsonFile<T>(name: string, fallback: T): Promise<T> {
  try {
    const p = path.join(DATA_DIR, name);
    const s = await fs.readFile(p, "utf-8");
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
async function writeJsonFile<T>(name: string, data: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, name);
  // Write to temp then rename for atomic replace
  const tmp = path.join(DATA_DIR, `.${name}.tmp-${randomUUID()}`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, p);
}

// ---------- Skills ----------
export async function readSkills(): Promise<SkillDoc[]> {
  const dirs = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const docs: SkillDoc[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, d.name, "SKILL.md");
    try {
      const raw = await fs.readFile(skillFile, "utf-8");
      docs.push(parseFrontmatter(raw, d.name, skillFile));
    } catch {
      /* skip */
    }
  }
  return docs.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export async function getSkill(id: string): Promise<SkillDoc | null> {
  const skillFile = path.join(SKILLS_DIR, id, "SKILL.md");
  try {
    const raw = await fs.readFile(skillFile, "utf-8");
    return parseFrontmatter(raw, id, skillFile);
  } catch {
    return null;
  }
}

export async function saveSkill(doc: SkillDoc): Promise<void> {
  const dir = path.join(SKILLS_DIR, doc.meta.id);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "SKILL.md");
  await fs.writeFile(target, stringifyFrontmatter(doc), "utf-8");
}

export async function createSkill(id: string, name: string, systemPrompt: string, model = "doubao-seed-2-0-mini-260215"): Promise<SkillDoc> {
  const doc: SkillDoc = {
    meta: {
      id,
      name,
      model,
      temperature: 0.3,
      maxTokens: 800,
      enabled: true,
      requiredTools: [],
    },
    systemPrompt,
    filePath: path.join(SKILLS_DIR, id, "SKILL.md"),
  };
  await saveSkill(doc);
  return doc;
}

// ---------- Catalog ----------
export async function readProducts() {
  return readJsonFile<any>("products.json", { products: [] });
}
export async function writeProducts(d: any) {
  return writeJsonFile("products.json", d);
}
export async function readActivities() {
  return readJsonFile<any>("activities.json", { activities: [] });
}
export async function writeActivities(d: any) {
  return writeJsonFile("activities.json", d);
}
export async function readCoupons() {
  return readJsonFile<any>("coupons.json", { coupons: [] });
}
export async function writeCoupons(d: any) {
  return writeJsonFile("coupons.json", d);
}
export async function readOrders() {
  return readJsonFile<any>("orders.json", { orders: [] });
}
export async function writeOrders(d: any) {
  return writeJsonFile("orders.json", d);
}
export async function readPolicies() {
  return readJsonFile<any>("return-policies.json", { policies: [] });
}
export async function writePolicies(d: any) {
  return writeJsonFile("return-policies.json", d);
}

// ---------- Planner Config ----------
export interface PlannerConfig {
  systemPrompt: string;
  model: string;
  temperature: number;
  requiredSkills: string[];
  coreTools: string[];
  priceTools: string[];
}
const DEFAULT_PLANNER: PlannerConfig = {
  model: "doubao-seed-2-0-lite-260215",
  temperature: 0.2,
  requiredSkills: ["need-extraction", "risk-check"],
  coreTools: ["query_products", "query_activities", "query_coupons"],
  priceTools: ["calculate_price"],
  systemPrompt: `你是小食铺客服 Agent 的规划器。基于用户问题、可用的 Skills 和 Tools 生成一个线性执行计划。

## 规则
- 你只能使用 available_skills 和 available_tools 列表里且 enabled=true 的能力
- 涉及价格/活动/优惠券，必须调用对应的 Tool，不许自己编造
- 计划最后一步必须是 risk-check
- 第一个 Skill 必须是 need-extraction（需求结构化）
- 用户说送礼 → 插入 gift-scenario-advisor
- 用户问过敏/孕妇/儿童 → 插入 allergy-risk-reminder
- 用户投诉/不满 → 插入 complaint-triage
- 售后/退货/换货 → 插入 after-sales-classification
- 用户需求不明确 → 插入 clarification-question
- 需求明确，流程顺畅时按 需求→推荐→理由→话术→风控 走

## 输出 JSON
{ "plan": [
  {"step": 1, "type": "skill|tool", "ref": "id", "description": "本步目的", "input": { /* 输入模板，可用 {{step_X.field}} 引用前面步骤 */ }}
] }`,
};
export async function readPlannerConfig(): Promise<PlannerConfig> {
  return readJsonFile<PlannerConfig>("planner.json", DEFAULT_PLANNER);
}
export async function writePlannerConfig(cfg: PlannerConfig) {
  return writeJsonFile("planner.json", cfg);
}

// ---------- Runs ----------
export interface StepRecord {
  stepIndex: number;
  type: "skill" | "tool";
  ref: string;
  refName: string;
  description: string;
  status: "pending" | "running" | "success" | "failed" | "skipped" | "degraded" | "error";
  input: unknown;
  output?: unknown;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  thinking?: string;
}
export interface RiskResult {
  passed: boolean;
  riskLevel: "low" | "medium" | "high";
  issues: Array<{ type: string; detail: string; severity?: "warning" | "blocker" }>;
  suggestedFix?: string;
}
export interface RunRecord {
  runId: string;
  id?: string;
  source: "user" | "demo" | "eval" | "replay" | "annotation";
  userQuestion?: string;
  question?: string;
  plan: unknown;
  steps: StepRecord[];
  finalReply?: string;
  reasoning?: string;
  riskResult?: RiskResult | null;
  risk?: RiskResult | null;
  error?: string | null;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  createdAt?: string;
  updatedAt?: string;
  status: "running" | "success" | "failed" | "risk_blocked" | "error" | "risk_failed";
  isBadCase?: boolean;
  badCaseNote?: string;
  note?: string;
  tags?: string[];
  rating?: number;
  ratingComment?: string;
  skillsUsed?: string[];
  toolsUsed?: string[];
  conversationTurns?: Array<{ role: "user" | "assistant"; content: string; ts: number }>;
  handoffToHuman?: boolean;
  handoffReason?: string;
  handoffIssues?: string[];
  handoffAt?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string | null;
  evalBatchId?: string;
  evalCaseId?: string;
  evalPassed?: boolean;
  evalFailReason?: string;
}

export async function readRuns(): Promise<{ runs: RunRecord[] }> {
  return readJsonFile<{ runs: RunRecord[] }>("runs.json", { runs: [] });
}
export async function saveRun(run: RunRecord) {
  const { runs } = await readRuns();
  const idx = runs.findIndex((r) => r.runId === run.runId);
  run.updatedAt = new Date().toISOString();
  if (idx >= 0) runs[idx] = run;
  else runs.unshift(run);
  await writeJsonFile("runs.json", { runs });
}
export async function getRun(runId: string): Promise<RunRecord | null> {
  const { runs } = await readRuns();
  const run = runs.find((r) => r.runId === runId);
  if (run) return run;
  // Fallback: eval batch runId (e.g. eval_xxx) — synthetic RunRecord so /runs/[id] page works
  try {
    const batches = await listEvalBatches();
    for (const b of batches) {
      if (!b.caseResults) continue;
      const pair = Object.entries(b.caseResults).find(
        ([, cr]) => cr && (cr as any).runId === runId
      );
      if (pair) {
        const [cid, cr] = pair as [string, any];
        const cases = await listEvalCases();
        const ec = cases.find((c) => c.id === cid);
        const ev = cr.evidence || {};
        const synth: any = {
          runId,
          question: ec?.question || cid,
          finalReply: cr.finalReply || "",
          status: cr.error ? "failed" : "success",
          source: "eval",
          durationMs: cr.durationMs || 0,
          totalTokens: ev.tokensUsed || 0,
          llmCalls: ev.stepsExecuted || 1,
          toolCalls: (ev.toolsUsed || []).length,
          startedAt: b.createdAt,
          finishedAt: b.finishedAt || b.createdAt,
          plan: {
            requiredCapabilities: [],
            forbiddenCapabilities: ec?.forbiddenCapabilities || [],
            steps: [],
            confidence: 1,
            reasoning: "批量评测单条执行",
            ttlMs: 30000,
          },
          steps: [
            {
              ref: "eval-run",
              refName: "评测执行",
              type: "tool",
              status: cr.error ? "error" : "success",
              input: { question: ec?.question || "" },
              output: { reply: cr.finalReply || "" },
              startedAt: b.createdAt,
              finishedAt: b.finishedAt || b.createdAt,
              error: cr.error,
            } as any,
          ],
          risk:
            cr.riskPassed === undefined
              ? undefined
              : {
                  passed: !!cr.riskPassed,
                  riskLevel: (cr.riskPassed ? "low" : "high") as "low" | "medium" | "high",
                  issues: cr.reason
                    ? [{ type: "eval", severity: "blocker" as const, detail: cr.reason }]
                    : [],
                  suggestedFix: "",
                },
          createdAt: b.createdAt,
          conversationId: b.id,
          annotationStatus: "pending",
          handoffToHuman: false,
          needsClarification: false,
          cost: 0,
        };
        return synth;
      }
    }
  } catch {}
  return null;
}

export async function annotateRun(runId: string, patch: Partial<RunRecord>) {
  const run = await getRun(runId);
  if (!run) return null;
  Object.assign(run, patch);
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  return run;
}

// ---------- Eval ----------
export interface EvalCase {
  id: string;
  name?: string;
  scenario?: string;
  question: string;
  expectedKeywords: string[];
  expectedPrice?: number;
  expectedProductIds?: string[];
  expectRiskPassed?: boolean;
  expectedIntent?: string;
  expectedReply?: string;
  requiredCapabilities?: string[];
  forbiddenCapabilities?: string[];
  evalDimension: "keyword" | "price" | "risk" | "intent" | "llm_judge" | "mixed";
  llmJudgePrompt?: string;
  tags?: string[];
  sourceRunId?: string;
  createdAt?: string;
  enabled: boolean;
  forbiddenWords?: string[];
}
export interface EvalCaseEvidence {
  keywordHits?: Record<string, boolean>;
  keywordChecks?: Array<{ group: string; matched?: string; passed: boolean }>;
  keywordMisses?: string[];
  keywordMatched?: boolean;
  priceExpected?: number;
  priceFound?: number | null;
  expectedPrice?: number;
  mentionedPrice?: number | null;
  priceAccurate?: boolean;
  riskExpected?: boolean;
  riskActual?: boolean;
  riskAccurate?: boolean;
  riskIssues?: string[];
  risk?: { passed?: boolean; issues?: string[] };
  forbiddenHits?: string[];
}
export interface EvalCaseResult {
  caseId: string;
  status: "PASS" | "FAIL" | "REVIEW" | "ERROR";
  passed: boolean;
  reason?: string;
  runId?: string;
  finalReply?: string;
  riskPassed?: boolean;
  priceMatched?: boolean;
  priceAccurate?: boolean;
  durationMs?: number;
  error?: string;
  evidence?: EvalCaseEvidence;
}
export interface EvalConditionSnapshot {
  capturedAt: string;
  caseSetHash: string;
  evaluatorVersion: string;
  evaluatorHash: string;
  provider: string;
  model: string;
  paramsHash: string;
  plannerHash: string;
  skillHashes: Record<string, string>;
  toolHash: string;
  businessDataHash: string;
}
export interface EvalBatchRun {
  id: string;
  batchId?: string;
  name?: string;
  baselineBatchId?: string;
  createdAt: string;
  finishedAt?: string;
  status: "pending" | "running" | "done" | "completed" | "error";
  total: number;
  passed: number;
  failed: number;
  review: number;
  errors: number;
  passRate?: number;
  currentIndex?: number;
  caseResults: Record<string, EvalCaseResult>;
  caseIds?: string[];
  caseSnapshot?: EvalCase[];
  conditionSnapshot?: EvalConditionSnapshot;
  error?: string;
}
export async function listEvalCases() {
  const { cases } = await readEvalCases();
  return cases;
}
export async function readEvalCases(): Promise<{ cases: EvalCase[] }> {
  return readJsonFile<{ cases: EvalCase[] }>("eval_cases.json", { cases: [] });
}
export async function writeEvalCases(d: { cases: EvalCase[] }) {
  return writeJsonFile("eval_cases.json", d);
}
export async function readEvalBatches(): Promise<{ batches: EvalBatchRun[] }> {
  return readJsonFile<{ batches: EvalBatchRun[] }>("eval_batches.json", { batches: [] });
}
export async function writeEvalBatches(d: { batches: EvalBatchRun[] }) {
  return writeJsonFile("eval_batches.json", d);
}
export async function listEvalBatches(limit = 20) {
  const { batches } = await readEvalBatches();
  return batches.slice(0, limit);
}
export async function getEvalBatch(id: string): Promise<EvalBatchRun | null> {
  const { batches } = await readEvalBatches();
  return batches.find((b) => b.id === id) || null;
}
export async function saveEvalBatch(b: EvalBatchRun) {
  await withFileLock("eval_batches.json", async () => {
    const { batches } = await readEvalBatches();
    const idx = batches.findIndex((x) => x.id === b.id);
    if (idx >= 0) batches[idx] = b;
    else batches.unshift(b);
    await writeEvalBatches({ batches });
  });
}
export async function updateEvalCase(_id: string, _patch: any) {
  // MVP 占位
}
export async function addEvalCase(c: EvalCase) {
  await withFileLock("eval_cases.json", async () => {
    const { cases } = await readEvalCases();
    cases.unshift(c);
    await writeEvalCases({ cases });
  });
}

// ---------- Improvements ----------
export interface Improvement {
  id: string;
  source: "bad_case" | "low_rating" | "eval_fail" | "annotation" | "auto";
  title: string;
  description: string;
  targetType: "skill" | "tool" | "planner" | "eval";
  targetId?: string;
  suggestedPromptChange?: string;
  weakDimensions?: string[];
  severity: "low" | "medium" | "high";
  status: "open" | "applied" | "dismissed";
  createdAt: string;
  relatedRunId?: string;
}
export async function readImprovements(): Promise<{ improvements: Improvement[] }> {
  return readJsonFile<{ improvements: Improvement[] }>("improvements.json", { improvements: [] });
}
export async function writeImprovements(d: { improvements: Improvement[] }) {
  return writeJsonFile("improvements.json", d);
}

// ---------- Ratings ----------
export interface RatingRecord {
  id: string;
  conversationId: string;
  /** 评分 1~5；历史数据同时以 rating/score 字段兼容 */
  rating: number;
  score?: number;
  /** 用户最后一条提问 */
  question?: string;
  /** AI 最终回复 */
  reply?: string;
  /** 用户留言 */
  comment?: string;
  messages: { role: string; content: string }[];
  createdAt: string;
  isBadCase?: boolean;
}
/** 统一评分值字段（兼容 rating/score） */
export function ratingScore(r: RatingRecord): number {
  return r.score ?? r.rating ?? 0;
}
export async function readRatings(): Promise<{ ratings: RatingRecord[] }> {
  return readJsonFile<{ ratings: RatingRecord[] }>("ratings.json", { ratings: [] });
}
export function appendRating(payload: {
  conversationId: string;
  rating: number;
  messages: { role: string; content: string }[];
}): RatingRecord {
  const rec: RatingRecord = {
    id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    conversationId: payload.conversationId,
    rating: payload.rating,
    messages: payload.messages,
    createdAt: new Date().toISOString(),
    isBadCase: payload.rating === 1,
  };
  const file = path.join(DATA_DIR, "ratings.json");
  let data: { ratings: RatingRecord[] } = { ratings: [] };
  try {
    const raw = require("fs").readFileSync(file, "utf-8");
    data = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  data.ratings.unshift(rec);
  require("fs").writeFileSync(file, JSON.stringify(data, null, 2));
  if (payload.rating === 1) {
    const impFile = path.join(DATA_DIR, "improvements.json");
    let imps: { improvements: Improvement[] } = { improvements: [] };
    try {
      imps = JSON.parse(require("fs").readFileSync(impFile, "utf-8"));
    } catch {}
    const lastUser = [...payload.messages].reverse().find((m) => m.role === "user");
    const lastAi = [...payload.messages].reverse().find((m) => m.role === "assistant");
    imps.improvements.unshift({
      id: `imp_${Date.now()}`,
      source: "low_rating",
      title: `1 分差评：${(lastUser?.content || "").slice(0, 30)}`,
      description: `用户问题：${lastUser?.content || ""}\nAI回复：${lastAi?.content || ""}`,
      targetType: "skill",
      weakDimensions: ["overall"],
      severity: "high",
      status: "open",
      createdAt: new Date().toISOString(),
    });
    require("fs").writeFileSync(impFile, JSON.stringify(imps, null, 2));
  }
  return rec;
}

// ---------- Tool Configs ----------
export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  implementation: "local" | "mcp";
  sourceFile?: string;
  dataSource?: string;
  mcpServer?: string;
  category: "data" | "calc" | "write" | "knowledge" | "external";
}

const DEFAULT_TOOLS: ToolConfig[] = [
  { id: "query_products", name: "查询商品", description: "按关键词/品类/口味/预算/场景过滤商品库", enabled: true, implementation: "local", sourceFile: "src/lib/tools.ts", dataSource: "data/products.json", category: "data" },
  { id: "query_activities", name: "查询活动", description: "查询满减、折扣、新客、品类活动", enabled: true, implementation: "local", sourceFile: "src/lib/tools.ts", dataSource: "data/activities.json", category: "data" },
  { id: "query_coupons", name: "查询优惠券", description: "查询可用优惠券，自动选最优", enabled: true, implementation: "local", sourceFile: "src/lib/tools.ts", dataSource: "data/coupons.json", category: "data" },
  { id: "calculate_price", name: "计算价格", description: "满减→品类折扣→新客立减→优惠券→finalPrice", enabled: true, implementation: "local", sourceFile: "src/lib/tools.ts", category: "calc" },
  { id: "query_order", name: "查询订单", description: "根据订单号/手机号查询订单状态、商品明细、支付金额", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/orders.json", category: "data" },
  { id: "query_return_policy", name: "退换货政策", description: "查询售后/退换货政策（按品类/场景）", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/return-policies.json", category: "knowledge" },
  { id: "track_logistics", name: "查询物流轨迹", description: "根据运单号查询承运商、当前状态、物流轨迹、预计送达时间", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/logistics.json", category: "external" },
  { id: "search_faq", name: "知识库搜索", description: "搜索内部 FAQ 知识库（发货/支付/售后/优惠/会员/配送等常见问题），返回最相关的标准答案", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/faq.json", category: "knowledge" },
  { id: "query_user_profile", name: "查询用户画像", description: "根据 userId/手机号查询用户等级、累计消费、历史标签、过敏信息，用于个性化推荐和过敏风险提示", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/users.json", category: "data" },
  { id: "estimate_delivery", name: "预估配送时效", description: "根据收货地址/商品品类/下单时间估算送达时间，并返回推荐发货仓", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", category: "calc" },
  { id: "create_after_sales_ticket", name: "创建售后工单", description: "为用户创建退货/换货/补发/投诉工单，返回工单号用于跟踪。需要订单号、问题类型、用户描述。", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", dataSource: "data/tickets.json", category: "write" },
  { id: "reserve_stock", name: "锁定库存", description: "下单前锁定指定商品的库存（15分钟有效），返回锁定结果与预计出库时间", enabled: false, implementation: "local", sourceFile: "src/lib/tools-ex.ts", category: "write" },
  { id: "parse_address", name: "解析收货地址", description: "把用户自然语言描述的收货地址解析为 省/市/区/详细地址/联系人/手机号 结构化字段", enabled: true, implementation: "local", sourceFile: "src/lib/tools-ex.ts", category: "calc" },
];

export async function listToolConfigs(): Promise<ToolConfig[]> {
  const d = await readJsonFile<{ tools: ToolConfig[] }>("tools-config.json", { tools: DEFAULT_TOOLS });
  const existing = new Set(d.tools.map((t) => t.id));
  // 新增工具补进去
  for (const dt of DEFAULT_TOOLS) {
    if (!existing.has(dt.id)) d.tools.push(dt);
  }
  // 已有工具同步元数据（name/description/category/sourceFile/dataSource）——防止 DEFAULT 更新后旧配置残留旧分类
  const byId = new Map(DEFAULT_TOOLS.map((t) => [t.id, t]));
  for (const t of d.tools) {
    const def = byId.get(t.id);
    if (def) {
      t.name = def.name;
      t.description = def.description;
      t.category = def.category;
      t.implementation = def.implementation;
      if (def.sourceFile) t.sourceFile = def.sourceFile;
      if (def.dataSource) t.dataSource = def.dataSource;
    }
  }
  return d.tools;
}

export async function updateToolConfig(id: string, patch: Partial<ToolConfig>): Promise<ToolConfig | null> {
  const list = await listToolConfigs();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  await writeJsonFile("tools-config.json", { tools: list });
  return list[idx];
}

// ---------- MCP Servers ----------
export interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  connectedAt?: string;
  tools?: { name: string; description: string }[];
}

export async function listMcpServers(): Promise<McpServer[]> {
  return (await readJsonFile<{ servers: McpServer[] }>("mcp-servers.json", { servers: [] })).servers;
}
export async function saveMcpServer(srv: McpServer) {
  const list = await listMcpServers();
  const idx = list.findIndex((s) => s.id === srv.id);
  if (idx >= 0) list[idx] = srv;
  else list.push(srv);
  await writeJsonFile("mcp-servers.json", { servers: list });
}

// ---------- Catalog CRUD ----------
export async function readCatalog(name: "products" | "activities" | "coupons" | "orders" | "returnPolicies") {
  const map: Record<string, string> = {
    products: "products.json",
    activities: "activities.json",
    coupons: "coupons.json",
    orders: "orders.json",
    returnPolicies: "return-policies.json",
  };
  return readJsonFile<any>(map[name], {});
}
export async function writeCatalog(name: "products" | "activities" | "coupons" | "orders" | "returnPolicies", data: any) {
  const map: Record<string, string> = {
    products: "products.json",
    activities: "activities.json",
    coupons: "coupons.json",
    orders: "orders.json",
    returnPolicies: "return-policies.json",
  };
  return writeJsonFile(map[name], data);
}

// ---------- Annotations ----------
export interface Annotation {
  id: string;
  question: string;
  reply: string;
  expectedReply?: string;
  intent?: string;
  riskLevel?: "low" | "medium" | "high";
  qualityTags?: string[];
  requiredCapabilities?: string[];
  expectedFacts?: string[];
  forbiddenPhrases?: string[];
  scores: {
    correctness: number;
    relevance: number;
    completeness: number;
    safety: number;
    tone: number;
    overall: number;
  };
  status: "pending" | "annotated" | "approved" | "rejected";
  annotatorNote?: string;
  reviewNote?: string;
  reviewedAt?: string;
  sourceRunId?: string;
  createdAt: string;
  runId?: string;
}
export async function listAnnotations(): Promise<Annotation[]> {
  return (await readJsonFile<{ annotations: Annotation[] }>("annotations.json", { annotations: [] })).annotations;
}
export async function saveAnnotation(a: Annotation) {
  const list = await listAnnotations();
  const idx = list.findIndex((x) => x.id === a.id);
  if (idx >= 0) list[idx] = a;
  else list.unshift(a);
  await writeJsonFile("annotations.json", { annotations: list.slice(0, 1000) });
}
export async function updateAnnotation(id: string, patch: Partial<Annotation>) {
  const list = await listAnnotations();
  const idx = list.findIndex((x) => x.id === id);
  const merged = { ...(idx >= 0 ? list[idx] : ({} as Annotation)), ...patch, id } as Annotation;
  if (idx >= 0) list[idx] = merged;
  else list.unshift(merged);
  await writeJsonFile("annotations.json", { annotations: list.slice(0, 1000) });
  return merged;
}

// ---------- A/B Tests ----------
export interface AbTest {
  id: string;
  name: string;
  targetType: "skill" | "planner";
  targetId: string;
  variantA: string;
  variantB: string;
  trafficSplit: number;
  status: "draft" | "running" | "paused" | "completed";
  winner?: "A" | "B" | "tie";
  metrics: { aPassRate: number; bPassRate: number; aCount: number; bCount: number };
  createdAt: string;
}
export async function listAbTests(): Promise<AbTest[]> {
  return (await readJsonFile<{ tests: AbTest[] }>("ab-tests.json", { tests: [] })).tests;
}
export async function saveAbTest(t: AbTest) {
  const list = await listAbTests();
  const idx = list.findIndex((x) => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.unshift(t);
  await writeJsonFile("ab-tests.json", { tests: list });
}

// ---------- Versions ----------
export interface Version {
  id: string;
  targetType: "skill" | "planner" | "tool";
  targetId: string;
  content: string;
  message: string;
  createdAt: string;
}
export async function listVersions(targetType: string, targetId: string): Promise<Version[]> {
  const all = (await readJsonFile<{ versions: Version[] }>("versions.json", { versions: [] })).versions;
  return all.filter((v) => v.targetType === targetType && v.targetId === targetId);
}
export async function saveVersion(v: Version) {
  const all = (await readJsonFile<{ versions: Version[] }>("versions.json", { versions: [] })).versions;
  all.unshift(v);
  await writeJsonFile("versions.json", { versions: all.slice(0, 500) });
}
export async function rollbackVersion(id: string) {
  const all = (await readJsonFile<{ versions: Version[] }>("versions.json", { versions: [] })).versions;
  const v = all.find((x) => x.id === id);
  if (!v) return null;
  if (v.targetType === "skill") {
    const { writeSkillFile } = await import("./skills-registry");
    writeSkillFile(v.targetId, v.content);
  }
  return v;
}
