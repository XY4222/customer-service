import { callLLM, isFixtureMode } from "./llm";
import { listSkills, type SkillManifest } from "./skills-registry";
import { getToolCatalog } from "./tools";
import { listToolConfigs } from "./store";

import { atomicWriteTextSync } from "./fs-atomic";
import fs from "fs";
import path from "path";

export interface PlanStep {
  step: number;
  type: "skill" | "tool";
  ref: string;
  description: string;
  input: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
  explanation?: string; // Planner 解释给用户/运营看的思考
}

export interface PlannerConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  mandatorySkills: string[]; // 必经 skill id（最后一个必须是 risk-check）
  basicTools: string[]; // 默认可调用
  priceTools: string[]; // 涉及价格/活动/券时必须调用
  enabled: boolean;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  model: "doubao-seed-2-0-lite-260215",
  temperature: 0.2,
  maxTokens: 1200,
  systemPrompt: `你是零食电商客服 Agent 的 Planner。基于用户问题和多轮历史，生成执行计划 JSON。

## 严格规则
1. 只能引用"可用能力"中列出且启用的 skill id / tool id
2. 涉及价格、活动、优惠券、库存，必须用对应的 tool，禁止 LLM 编造
3. 最后一步必须是 risk-check（风控审核），如果 risk-check 未启用则直接返回错误计划
4. 涉及订单/售后问题必须调用 query_order / query_return_policy tool
5. 用户情绪激烈/明确要求人工/食品安全问题 → 加入 human-handoff-decision
6. 用户问题模糊 → 加入 clarification-question（必要时）
7. 过敏原提示场景 → 加入 allergy-risk-reminder（在 response-generator 之前）
8. 送礼场景 → 加入 gift-scenario-advisor 替代/补充 recommendation-decision
9. 投诉 → complaint-triage + 可能的 human-handoff-decision
10. 售后 → after-sales-classification + query_order/query_return_policy
11. 第一步始终是 need-extraction（结构化需求）
12. 占位符格式：{{step_N}} 引用第 N 步整体输出；{{step_N.field}} 引用具体字段；不要加 .output 中间层

## 输出 JSON 格式
{"steps":[{"step":1,"type":"skill|tool","ref":"能力id","description":"该步目的","input":{...}}],"reasoning":"决策思路","explanation":"给运营看的规划解释"}`,
  mandatorySkills: ["risk-check"],
  basicTools: ["query_products"],
  priceTools: ["query_activities", "query_coupons", "calculate_price"],
  enabled: true,
};

const PLANNER_CONFIG_PATH = path.join(
  process.cwd(),
  "data",
  "planner-config.json"
);

export function readPlannerConfig(): PlannerConfig {
  try {
    const raw = fs.readFileSync(PLANNER_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PLANNER_CONFIG, ...parsed };
  } catch {
    return DEFAULT_PLANNER_CONFIG;
  }
}

export function writePlannerConfig(cfg: Partial<PlannerConfig>) {
  const cur = readPlannerConfig();
  const next = { ...cur, ...cfg };
  fs.mkdirSync(path.dirname(PLANNER_CONFIG_PATH), { recursive: true });
  atomicWriteTextSync(PLANNER_CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

function capabilitiesBlock(
  skills: SkillManifest[],
  tools: ReturnType<typeof getToolCatalog>
) {
  const skillLines = skills
    .filter((s) => s.enabled)
    .map(
      (s) =>
        `- [skill] ${s.id}：${s.name}（${s.description || ""}）${
          s.requiredTools?.length ? ` 可能调用: ${s.requiredTools.join(",")}` : ""
        }`
    )
    .join("\n");
  const toolLines = tools
    .filter((t) => t.enabled)
    .map(
      (t) =>
        `- [tool] ${t.id}：${t.name}（${t.description}）参数: ${t.parameters
          .map(
            (p) => `${p.name}:${p.type}${p.required ? "" : "?"}=${p.description}`
          )
          .join(", ")}`
    )
    .join("\n");
  return `【可用 Skills】\n${skillLines}\n\n【可用 Tools】\n${toolLines}`;
}

/** Fallback 线性计划：新客推荐 9 步（step 从 1 开始，1-based，与 executor 的 stepsOut key 一致） */
export function fallbackPlan(): Plan {
  return {
    reasoning: "LLM 生成计划失败，使用兜底 9 步线性流程",
    explanation: "使用兜底推荐流程：结构化→查商品→查活动→查券→选品→算价→生成理由→生成话术→风控",
    steps: [
      { step: 1, type: "skill", ref: "need-extraction", description: "结构化用户需求", input: { question: "{{question}}", history: "{{history}}" } },
      { step: 2, type: "tool", ref: "query_products", description: "按需求过滤商品", input: { keywords: "{{step_1.keywords}}", category: "{{step_1.categories.0}}", flavorTags: "{{step_1.flavorTags}}", maxBudget: "{{step_1.budget.max}}", scenario: "{{step_1.scenario}}", limit: 5 } },
      { step: 3, type: "tool", ref: "query_activities", description: "查询优惠活动", input: { isNewUser: "{{step_1.isNewUser}}", category: "{{step_1.categories.0}}" } },
      { step: 4, type: "tool", ref: "query_coupons", description: "查询可用优惠券", input: { category: "{{step_1.categories.0}}", isNewUser: "{{step_1.isNewUser}}" } },
      { step: 5, type: "skill", ref: "recommendation-decision", description: "决策推荐商品", input: { userNeed: "{{step_1}}", products: "{{step_2.products}}", activities: "{{step_3.activities}}", coupons: "{{step_4.coupons}}", budgetMax: "{{step_1.budget.max}}" } },
      { step: 6, type: "tool", ref: "calculate_price", description: "计算到手价", input: { productIds: "{{step_5.selectedProductIds}}", isNewUser: "{{step_1.isNewUser}}" } },
      { step: 7, type: "skill", ref: "recommendation-reason", description: "生成卖点文案", input: { products: "{{step_2.products}}", selectedIds: "{{step_5.selectedProductIds}}", price: "{{step_6}}" } },
      { step: 8, type: "skill", ref: "response-generator", description: "生成客服回复", input: { userNeed: "{{step_1}}", products: "{{step_2.products}}", selected: "{{step_5}}", reasons: "{{step_7}}", price: "{{step_6}}", activities: "{{step_3.activities}}", coupons: "{{step_4.coupons}}", finalPrice: "{{step_6.finalPrice}}" } },
      { step: 9, type: "skill", ref: "risk-check", description: "风控审核", input: { reply: "{{step_8.reply}}", price: "{{step_6}}", finalPrice: "{{step_6.finalPrice}}", userNeed: "{{step_1}}", isNewUser: "{{step_1.isNewUser}}" } },
    ],
  };
}

/** 生成计划：history 为多轮历史；memoryContext 为跨会话长期记忆（可选） */
export async function generatePlan(params: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  memoryContext?: string;
}): Promise<Plan> {
  return computePlan(params);
}

async function computePlan(params: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  memoryContext?: string;
}): Promise<Plan> {
  const { question, history = [], memoryContext = "" } = params;
  const cfg = readPlannerConfig();
  if (!cfg.enabled) {
    return { ...fallbackPlan(), reasoning: "Planner 已停用，使用确定性兜底计划" };
  }

  const skills = listSkills();

  // 风控 skill 必须存在且启用——放在 fixture 短路之前，保证"风控未启用则拒绝生成回复"这条
  // 安全不变量对两条路径都成立
  const riskSkill = skills.find((s) => s.id === "risk-check");
  if (!riskSkill || !riskSkill.enabled) {
    return {
      reasoning: "风控 skill 未启用，不能生成回复",
      explanation: "risk-check 被停用，按安全规则禁止生成未经审核的回复",
      steps: [],
    };
  }

  // 演示稳定模式没有可用的规划模型：直接返回确定性兜底计划。
  // （fixture 按 systemPrompt 识别能力，而 Planner 调用时传的是空 systemPrompt，
  //   所以硬走模型只会拿到通用兜底话术并打出“JSON parse failed”的误导日志。）
  if (isFixtureMode()) {
    return {
      ...fallbackPlan(),
      reasoning: "演示稳定模式（classroom-fixture）：使用确定性兜底计划，不调用模型",
    };
  }

  // 工具启停以 tools-config.json 为准：getToolCatalog 只描述工具本身（并硬编码 enabled=true），
  // 不掌握真实启停状态，直接用它会让 Planner 看到被禁用的工具。
  const toolConfigs = await listToolConfigs();
  const availableToolIds = new Set(toolConfigs.filter((t) => t.enabled).map((t) => t.id));
  const tools = getToolCatalog().map((t) => ({ ...t, enabled: availableToolIds.has(t.id) }));

  const prompt = `${cfg.systemPrompt}

## 可用能力
${capabilitiesBlock(skills, tools)}

## 用户长期记忆（跨会话画像，规划时参考）
${memoryContext || "（暂无历史记忆）"}

## 多轮历史（最近 6 轮）
${history
  .slice(-6)
  .map((m) => `${m.role === "user" ? "用户" : "客服"}: ${m.content}`)
  .join("\n")}

## 当前用户问题
${question}

请输出严格 JSON，不要输出任何解释文本，不要 \`\`\`json 代码块包裹。`;

  try {
    const raw = await callLLM({
      model: cfg.model,
      systemPrompt: "",
      userPrompt: prompt,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });
    let parsed: { steps?: PlanStep[]; thinking?: string; reasoning?: string; explanation?: string } | null = null;
    try {
      const jsonStr = extractJSON(raw);
      if (jsonStr) parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.warn("[planner] JSON parse failed, fallback to default plan", e);
    }
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return fallbackPlan();
    }
    // 校验引用合法性：未注册或未启用的能力一律丢弃（注意：这里会静默丢步，改动技能/工具后请跑 pnpm audit:capabilities）
    const enabledSkillIds = new Set(skills.filter((s) => s.enabled).map((s) => s.id));
    const enabledToolIds = availableToolIds;
    const validSteps = parsed.steps
      .map((s: any, i: number) => ({ ...s, step: s.step || i + 1 }))
      .filter(
        (s: PlanStep) =>
          (s.type === "skill" && enabledSkillIds.has(s.ref)) ||
          (s.type === "tool" && enabledToolIds.has(s.ref))
      );
    // 最后一步必须是 risk-check
    if (validSteps.length === 0 || validSteps[validSteps.length - 1].ref !== "risk-check") {
      const last = validSteps[validSteps.length - 1];
      if (!last || last.ref !== "risk-check") {
        validSteps.push({
          step: validSteps.length + 1,
          type: "skill",
          ref: "risk-check",
          description: "风控审核",
          input: { reply: `{{step_${validSteps.length}}}`, price: "{{step_calc_price}}", isNewUser: "{{step_1.isNewUser}}" },
        });
      }
    }
    return {
      steps: validSteps.map((s: PlanStep, i: number) => ({ ...s, step: i + 1 })),
      reasoning: parsed.reasoning || "",
      explanation: parsed.explanation || "",
    };
  } catch (e) {
    console.error("[Planner] 生成失败，使用 fallback:", e);
    return fallbackPlan();
  }
}

function extractJSON(s: string) {
  s = s.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

