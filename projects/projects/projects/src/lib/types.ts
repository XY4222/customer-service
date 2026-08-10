/**
 * 核心类型定义（单一可信源）
 * 修改类型时，必须同步检查相关 API、组件和 data JSON。
 */

/* =========================
 *  Skill / Tool / Planner
 * ========================= */

/** Skill 运行时配置（对应 data/skills.json 中单项，来自 agents/openai.yaml + SKILL.md） */
export interface Skill {
  id: string;
  name: string;
  description: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  /** 必须搭配的 Tool（Planner 可参考） */
  requiredTools?: string[];
  /** SKILL.md 正文（YAML frontmatter 已解析到字段中） */
  body?: string;
  /** 输入 JSON Schema（可选） */
  inputSchema?: Record<string, unknown>;
  /** 输出 JSON Schema（可选） */
  outputSchema?: Record<string, unknown>;
  updatedAt?: string;
}

/** Skill 运行期可调的临时覆盖参数 */
export interface SkillRuntimeConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

/** Tool 元信息（来自 lib/tools.ts 内置 + data/tools-config.json 启停 + MCP 远端） */
export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  /** local: 本地代码实现; mcp: MCP Server 远端实现 */
  implementation: "local" | "mcp";
  enabled: boolean;
  /** 本地实现源文件或 MCP Server id */
  sourceFile?: string;
  /** MCP Server id，仅 implementation=mcp */
  mcpServerId?: string;
  /** 数据源文件路径（本地查询类 Tool） */
  dataSource?: string;
  /** 分类：data=本地数据查询 / calc=代码计算 / external=外部集成 */
  category?: "data" | "calc" | "external";
  parameters?: ToolParameter[];
  /** 入参 JSON Schema */
  inputSchema?: Record<string, unknown>;
  builtin?: boolean;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
}

/** Planner 可配置项 */
export interface PlannerConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  /** 系统 Prompt 主体 */
  systemPrompt: string;
  /** 每一轮用户问题都会附加的硬规则 */
  hardRules: string[];
  /** 必经 Skill（无论 LLM 怎么选，这些必须在 plan 中） */
  requiredSkills: string[];
  /** 涉及价格/活动/券时必须调用的 Tool */
  priceTools: string[];
  /** 兜底启用的基础 Tool */
  baseTools: string[];
  /** 最终回复前必须经过的风控 Skill */
  finalRiskSkill: string;
  updatedAt?: string;
}

/* =========================
 *  Plan / Execution Trace
 * ========================= */

export type StepType = "skill" | "tool";

export interface PlanStep {
  /** 步骤序号（0-based，执行时会转 stepIndex） */
  id: number;
  type: StepType;
  /** skill id 或 tool id */
  target: string;
  /** 自然语言描述 */
  description: string;
  /** 模板化输入，支持 {{step_N.field}} 引用前序输出 */
  input?: Record<string, unknown>;
}

export interface Plan {
  /** Planner 的思考过程（文本） */
  reasoning?: string;
  steps: PlanStep[];
  explanation?: string; // Planner 解释给用户/运营看的思考
}

/** Planner 决策过程事件（用于调试/可解释性） */
export interface PlannerDecisionEvent {
  phase: "context" | "rules" | "select" | "validate" | "fallback";
  message: string;
  detail?: unknown;
  ts: number;
}

/** 执行 Trace 单项 */
export interface TraceItem {
  stepIndex: number;
  type: StepType;
  target: string;
  description?: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "success" | "error" | "skipped";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string | null;
}

/* =========================
 *  Run 运行结果
 * ========================= */

export type RunSource = "user" | "eval" | "replay" | "demo";

export interface RiskCheckResult {
  passed: boolean;
  issues: string[];
  /** 风险等级：low/medium/high/critical */
  level?: "low" | "medium" | "high" | "critical";
}

export interface RunResult {
  id: string;
  question: string;
  source: RunSource;
  conversationHistory?: ConversationTurn[];
  plan: Plan | null;
  steps: TraceItem[];
  finalReply?: string;
  riskResult?: RiskCheckResult | null;
  handoffToHuman?: boolean;
  handoffReason?: string;
  status: "running" | "done" | "error" | "blocked";
  error?: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  /** Eval 评测结果时填充 */
  evalCaseId?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  ts?: string;
}

/* =========================
 *  Eval
 * ========================= */

export type EvaluationScoringMethod =
  | "exact_match"
  | "keyword"
  | "price_check"
  | "risk_check"
  | "cosine_similarity"
  | "llm_judge"
  | "human_review";

export interface EvaluationCase {
  id: string;
  name: string;
  question: string;
  /** 期望关键词：支持 A|B 同义词组（组内任一命中即通过） */
  expectedKeywords?: (string | string[])[];
  /** 禁止出现的词 */
  forbiddenWords?: string[];
  /** 期望价格（>0 时校验回复里出现的第一笔金额） */
  expectedPrice?: number;
  /** 期望风控结果 */
  expectRiskPassed?: boolean;
  /** 期望走到的 Skill/Tool id */
  expectedCapabilityPath?: string[];
  /** 禁止走到的 Skill/Tool id */
  forbiddenCapabilities?: string[];
  /** 期望能力（维度名） */
  expectedSkills?: string[];
  /** 启用的评分方法 */
  scoringMethods?: EvaluationScoringMethod[];
  /** LLM-as-Judge 的自定义 rubric */
  judgeRubric?: string;
  category?: string;
  enabled: boolean;
  /** Eval 通过与否需要满足的判定策略：any=任一方法通过即通过; all=所有方法都需通过 */
  passStrategy?: "any" | "all";
  createdAt?: string;
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  score?: number;
  /** 逐项判定 */
  checks: {
    method: EvaluationScoringMethod;
    passed: boolean;
    evidence?: unknown;
    detail?: string;
  }[];
  finalReply?: string;
  riskPassed?: boolean;
  detectedPrice?: number;
  matchedKeywords?: string[];
  forbiddenHits?: string[];
  capabilityPath?: string[];
  runId?: string;
  durationMs?: number;
  error?: string;
}

export interface EvaluationBatch {
  id: string;
  name: string;
  model: string;
  createdAt: string;
  finishedAt?: string;
  status: "running" | "done" | "error";
  totalCases: number;
  passedCases: number;
  failedCases: number;
  results: EvaluationResult[];
  /** LLM-as-Judge Prompt（可在评测中心修改） */
  llmJudgePrompt?: string;
}

/* =========================
 *  标注 / 评分 / 改进建议
 * ========================= */

export interface QualityDimensions {
  correctness: number; // 1-5
  relevance: number;
  completeness: number;
  safety: number;
  tone: number;
  overall: number;
}

export type AnnotationStatus = "pending" | "annotated" | "approved" | "rejected";

export interface AnnotationRecord {
  id: string;
  runId?: string;
  question: string;
  answer: string;
  expectedAnswer?: string;
  intent?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  qualityTags?: string[];
  requiredCapabilities?: string[];
  expectedFacts?: string[];
  forbiddenPhrases?: string[];
  quality?: QualityDimensions;
  note?: string;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt?: string;
  reviewer?: string;
}

export interface ServiceRating {
  id: string;
  runId?: string;
  question: string;
  answer?: string;
  score: number; // 1-5
  comment?: string;
  source: RunSource;
  createdAt: string;
}

export interface ImprovementSuggestion {
  id: string;
  /** 问题来源 */
  source: "rating" | "annotation" | "eval" | "trace";
  sourceId: string;
  /** 影响的目标 */
  target: "skill" | "planner" | "tool" | "eval" | "catalog";
  targetId?: string;
  /** 弱项维度 */
  weakDimension?: keyof QualityDimensions;
  summary: string;
  suggestedPromptPatch?: string;
  suggestedSkillDraft?: string;
  autoApplied: boolean;
  status: "open" | "reviewing" | "merged" | "dismissed";
  createdAt: string;
}

/* =========================
 *  Prompt A/B & 版本
 * ========================= */

export interface PromptExperiment {
  id: string;
  name: string;
  target: "planner" | "skill";
  targetId: string;
  /** 对照组配置 */
  controlPrompt: string;
  /** 实验组配置 */
  variantPrompts: { name: string; prompt: string; traffic?: number }[];
  /** 命中的 Eval Case ids */
  evalCaseIds?: string[];
  status: "draft" | "running" | "paused" | "finished";
  results?: {
    variantName: string;
    passed: number;
    total: number;
    winRate?: number;
  }[];
  createdAt: string;
}

export interface VersionSnapshot {
  id: string;
  /** 当前完整配置（skills + planner + tools-config + data）快照 */
  snapshot: {
    skills: Skill[];
    planner: PlannerConfig;
    tools: ToolConfig[];
  };
  message: string;
  createdAt: string;
  /** 发布/回滚时的 Eval batch id */
  evalBatchId?: string;
}

/* =========================
 *  MCP
 * ========================= */

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  /** 仅保存环境变量名，不保存明文 Token */
  tokenEnvName?: string;
  enabled: boolean;
  /** 已发现的 Tool 列表 */
  discoveredTools?: ToolConfig[];
  status?: "disconnected" | "connected" | "error";
  lastConnectedAt?: string;
  errorMsg?: string;
}

/* =========================
 *  API 响应约定
 * ========================= */

export interface ApiError {
  error: string;
  detail?: string;
}
