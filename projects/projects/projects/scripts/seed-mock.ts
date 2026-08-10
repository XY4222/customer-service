/**
 * 生成演示用 mock 数据填充 data/runs.json + data/ratings.json
 * 直接写 JSON，保证 ops 页所有卡片都有数据。
 * 用法：pnpm tsx scripts/seed-mock.ts
 */
import fs from "fs";
import path from "path";
import { buildStepIO } from "./seed-step-io";

const DATA = path.join(process.cwd(), "data");

type RiskIssue = string | { type: string; detail: string; severity: string };

type MockRun = {
  runId: string;
  id: string;
  source: "user" | "demo" | "eval" | "replay";
  userQuestion: string;
  question: string;
  plan: { reasoning: string; steps: unknown[] };
  finalReply?: string;
  reply?: string;
  risk?: { passed: boolean; riskLevel: "low" | "medium" | "high"; issues: RiskIssue[] };
  riskResult?: { passed: boolean; riskLevel: "low" | "medium" | "high"; issues: RiskIssue[]; level?: string };
  riskPassed?: boolean;
  riskLevel?: "low" | "medium" | "high";
  status: "success" | "failed" | "risk_blocked" | "error";
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  durationMs: number;
  handoffToHuman?: boolean;
  handoffReason?: string;
  handoffIssues?: Array<{ type: string; detail: string }>;
  needsClarification?: boolean;
  clarificationQuestion?: string | null;
  steps: Array<{
    stepIndex: number;
    step: number;
    type: "skill" | "tool";
    ref: string;
    refName: string;
    description: string;
    status: "pending" | "running" | "success" | "failed" | "skipped" | "degraded" | "error";
    durationMs?: number;
    error?: string | null;
    input?: unknown;
    output?: unknown;
    thinking?: string;
    startedAt?: string;
    finishedAt?: string;
  }>;
  isBadCase?: boolean;
  note?: string;
  tags?: string[];
};

const scenarios: Array<{
  q: string;
  risk: { passed: boolean; riskLevel: "low" | "medium" | "high"; issues: RiskIssue[] };
  status?: "success" | "risk_blocked" | "failed";
  handoff?: boolean;
  clarify?: boolean;
  degraded?: boolean;
  failedStepIdx?: number;
  failedStepError?: string;
  failedStepRef?: string; // 用哪个 step 失败；不填则按 STEP_DEFS[failedStepIdx]
  failedStepType?: "skill" | "tool";
  tags?: string[];
  final: string;
}> = [
  { q: "有什么办公室零食推荐吗？预算 30 元", risk: { passed: true, riskLevel: "low", issues: [] }, final: "推荐您试试办公室人气三件套：山药脆片、辣味魔芋爽和手作焦糖饼干，到手价 28.9 元，刚好卡在预算内。" },
  { q: "我想给孩子买酸甜口的零食", risk: { passed: true, riskLevel: "low", issues: [] }, final: "可以选我们的山楂果干和酸奶块，酸甜开胃，都是独立小包装，小朋友拿取方便，两份满 39 立减 5 元。" },
  { q: "老人适合吃什么零食，要低糖", risk: { passed: true, riskLevel: "low", issues: [] }, final: "推荐无添加红薯干和燕麦坚果酥，都是低糖无负担的配方，口感偏软好咀嚼，适合长辈。" },
  { q: "有没有熬夜追剧的饮料？", risk: { passed: true, riskLevel: "low", issues: [] }, final: "熬夜追剧推荐气泡水系列和冷萃咖啡液，配一包芝士薯片刚好，新人首单还能立减 8 元。" },
  { q: "有什么好吃的", risk: { passed: true, riskLevel: "low", issues: [] }, clarify: true, final: "请问您是想要甜口还是咸口的？大概预算多少？我好帮您挑最合适的～" },
  { q: "推荐点零食给朋友", risk: { passed: true, riskLevel: "low", issues: [] }, clarify: true, final: "送朋友的话想选礼盒还是散装呢？朋友喜欢辣的还是甜的？我给您搭配一下。" },
  {
    q: "我要投诉！吃了你们的辣条肚子痛！",
    risk: { passed: false, riskLevel: "high", issues: [{ type: "客诉升级", detail: "涉及食品安全与健康问题，需转人工", severity: "blocker" }] },
    status: "risk_blocked", handoff: true,
    final: "非常抱歉给您带来不好的体验，已为您接入人工客服，会第一时间跟进处理。",
  },
  {
    q: "我的订单什么时候发货？等了3天了",
    risk: { passed: false, riskLevel: "medium", issues: [{ type: "物流问题", detail: "需要查询订单实时状态，建议人工核对", severity: "warn" }] },
    status: "risk_blocked", handoff: true,
    final: "我先帮您查一下订单状态，同时为您接入客服同事跟进。",
  },
  {
    q: "我要退货退款，东西破了",
    risk: { passed: false, riskLevel: "medium", issues: [{ type: "售后诉求", detail: "商品破损申请退款，需走人工审核", severity: "warn" }] },
    status: "risk_blocked", handoff: true,
    final: "收到，商品破损可以申请退款，我帮您转人工客服快速处理。",
  },
  {
    q: "有什么坚果推荐",
    risk: { passed: true, riskLevel: "low", issues: [] },
    degraded: true, failedStepIdx: 2,
    failedStepError: "活动服务超时（504），使用无活动价兜底",
    final: "坚果类我们有每日坚果包和巴旦木，价格分别是 19.9 / 25.9，活动信息暂时拉取失败，但基础商品可以先了解一下。",
  },
  {
    q: "推荐低糖饼干",
    risk: { passed: true, riskLevel: "low", issues: [] },
    failedStepIdx: 4,
    failedStepRef: "recommendation-decision", failedStepType: "skill",
    failedStepError: "LLM 返回 JSON 格式错误：缺少 recommendedProducts 字段，已用兜底规则替代",
    final: "暂时没找到低糖饼干的精确匹配，推荐燕麦粗粮饼干作为替代，低糖高纤维，12.9 元/袋。",
  },
  {
    q: "你们零食吃了能减肥吗？100% 不会胖吗？",
    risk: { passed: false, riskLevel: "high", issues: [{ type: "夸大宣传风险", detail: "涉及功效/绝对化承诺，不允许使用'100%''绝对'等表述", severity: "blocker" }] },
    status: "risk_blocked",
    final: "零食是休闲食品，不能替代正餐或用于减肥目的哦，我们也不会做这种夸大承诺。",
  },
  { q: "新用户有什么优惠", risk: { passed: true, riskLevel: "low", issues: [] }, final: "新客首单立减 8 元，还能领一张 5 元无门槛券，两档优惠同享哦～" },
  { q: "满减和优惠券能叠加吗", risk: { passed: true, riskLevel: "low", issues: [] }, final: "满减和品类券可以叠加，无门槛券与满减券二选一，下单时系统会自动选择最优惠方案。" },
  { q: "礼盒怎么包装的", risk: { passed: true, riskLevel: "low", issues: [] }, final: "礼盒用牛皮纸手提盒，里面有防撞缓冲，送礼体面稳妥，支持手写贺卡。" },
  { q: "保质期到什么时候", risk: { passed: true, riskLevel: "low", issues: [] }, final: "每款商品保质期不同，膨化类一般 9 个月、果干类 12 个月，发货都是最近 1 个月生产的批次。" },
  { q: "魔芋爽多少钱一箱", risk: { passed: true, riskLevel: "low", issues: [] }, final: "魔芋爽单包 15.9 元，整箱 20 包活动价 258 元，合 12.9 元/包，更划算。" },
  { q: "能开发票吗", risk: { passed: true, riskLevel: "low", issues: [] }, final: "可以的，下单时备注发票抬头和税号，电子发票 1-3 个工作日发到您邮箱。" },
  {
    q: "这零食绝对是最好吃的，你们敢保证吗",
    risk: { passed: false, riskLevel: "high", issues: [{ type: "绝对化用语", detail: "回复中不得出现'绝对/100%/最'等承诺性表达", severity: "blocker" }] },
    status: "risk_blocked",
    final: "口味是主观感受，我们会如实描述商品特点，不会做 100% 满意这种承诺哦。",
  },
  {
    q: "我买的饼干碎了怎么办",
    risk: { passed: false, riskLevel: "medium", issues: [{ type: "售后诉求", detail: "商品破损，需走人工售后", severity: "warn" }] },
    status: "risk_blocked", handoff: true,
    final: "非常抱歉，商品破损可以申请补发或退款，我帮您接入人工客服。",
  },
  {
    q: "10 块钱以内有啥零食推荐？",
    risk: { passed: true, riskLevel: "low", issues: [] },
    final: "10 元以内可以选手作焦糖饼干小袋 8 元，或者辣味魔芋爽用 5 元无门槛券后到手 10.9 元，适合课间垫肚子。",
  },
  // —— 以下为扩充场景，覆盖更多失败类型与正常路径 ——
  { q: "你们有没有无糖巧克力？", risk: { passed: true, riskLevel: "low", issues: [] }, final: "有的，我们有 70% 黑巧克力和无糖可可豆两款，都是代糖配方不添加蔗糖，18.9 元/盒。" },
  { q: "想买点送长辈的礼盒，200 元预算", risk: { passed: true, riskLevel: "low", issues: [] }, final: "推荐「年味坚果礼盒」8 罐装 188 元，包装大气、坚果都是原味烘焙，长辈接受度高，200 元预算刚好还可以加一张贺卡。" },
  {
    q: "我对花生过敏，有什么能吃的？",
    risk: { passed: true, riskLevel: "medium", issues: [{ type: "过敏提示", detail: "需提示用户查看配料表并避免含花生制品", severity: "warn" }] },
    final: "对花生过敏的话推荐选水果干类、米饼类和果冻类商品，下单前请务必查看包装上的过敏原提示，有任何疑问我帮您再核对。",
  },
  { q: "你们家有没有辣味零食？", risk: { passed: true, riskLevel: "low", issues: [] }, final: "辣味系列有魔芋爽、香辣牛板筋、重庆火锅味土豆片，辣度从中辣到爆辣都有，满 39 包邮哦～" },
  { q: "孕妇能吃你们的零食吗", risk: { passed: true, riskLevel: "low", issues: [] }, final: "孕妇建议选低糖水果干、无添加坚果和原味烘焙类，避开含咖啡因、酒精和辛辣刺激的商品，具体可以看每款商品包装上的食用提示。" },
  {
    q: "你是不是机器人？我要找真人",
    risk: { passed: true, riskLevel: "low", issues: [] }, handoff: true,
    final: "好的，已经为您接入人工客服，请稍等片刻～",
  },
  {
    q: "你们卖假货，我要举报你们",
    risk: { passed: false, riskLevel: "high", issues: [{ type: "客诉升级", detail: "假货投诉涉及法律风险，必须转人工", severity: "blocker" }] },
    status: "risk_blocked", handoff: true,
    final: "非常抱歉给您带来困扰，已为您接入客诉专员处理，请保留好商品包装和凭证。",
  },
  { q: "我上次买的东西能再下单一模一样的吗", risk: { passed: true, riskLevel: "low", issues: [] }, final: "可以的，您进入「我的订单」找到上次的订单点「再来一单」就可以一键复购，价格会按当下活动重新计算。" },
  { q: "发什么快递？", risk: { passed: true, riskLevel: "low", issues: [] }, final: "我们默认发顺丰/圆通/京东物流，偏远地区会根据实际情况选择合适的承运商，不支持指定快递哦。" },
  { q: "有试吃装吗？", risk: { passed: true, riskLevel: "low", issues: [] }, final: "目前没有独立试吃装，但新人专区有 9.9 元尝鲜包，包含 5 款热门零食小份装，适合先试后买。" },
  {
    q: "帮我查一下订单 SF1234567890 到哪了",
    risk: { passed: true, riskLevel: "low", issues: [] }, tags: ["物流"],
    final: "SF1234567890 目前在上海转运中心，今天下午派送，预计 18:00 前送达，保持手机畅通哦。",
  },
  { q: "会员有什么用", risk: { passed: true, riskLevel: "low", issues: [] }, final: "银卡 95 折每月 2 张 5 元券，金卡 9 折每月 4 张 10 元券，钻石卡 88 折还有专属客服和新品抢先试吃，消费满额自动升级。" },
  { q: "支持 7 天无理由退货吗", risk: { passed: true, riskLevel: "low", issues: [] }, final: "未拆封商品支持 7 天无理由退货，食品类拆封后非质量问题不支持退换哦，有质量问题 24 小时内联系客服可全额退款。" },
  {
    q: "价格算错了吧，明明应该更便宜",
    risk: { passed: true, riskLevel: "medium", issues: [{ type: "价格争议", detail: "用户对价格有异议，需用 calculate_price 复核", severity: "warn" }] },
    degraded: true, failedStepIdx: 5,
    failedStepRef: "calculate_price", failedStepType: "tool",
    failedStepError: "价格服务超时，使用上一次缓存价格（可能不是最新）",
    final: "您稍等，我复核一下价格…目前显示的是活动价，如果您看到更低的价格可能是不同优惠券档位，我帮您核对一下最优方案。",
  },
  { q: "什么时候有活动", risk: { passed: true, riskLevel: "low", issues: [] }, final: "现在正在进行「夏日囤货节」，满 99 减 20 / 满 199 减 50，活动到本月底结束，部分爆品还有第二件半价。" },
  { q: "推荐点不辣的零食，追剧吃", risk: { passed: true, riskLevel: "low", issues: [] }, clarify: true, final: "追剧的话偏好甜口还是咸口呢？有没有特别喜欢的口感（脆的/糯的/软的）？我帮您挑合适的。" },
  { q: "买多少包邮", risk: { passed: true, riskLevel: "low", issues: [] }, final: "江浙沪皖满 39 包邮，其他地区满 59 包邮，偏远地区满 99 包邮，新人首单无门槛包邮。" },
  {
    q: "我要投诉你们客服态度差",
    risk: { passed: false, riskLevel: "high", issues: [{ type: "服务投诉", detail: "投诉客服态度需转人工处理", severity: "blocker" }] },
    status: "risk_blocked", handoff: true,
    final: "非常抱歉，我帮您转接客诉主管处理，会给您一个满意的答复。",
  },
  { q: "有没有适合当早餐的零食", risk: { passed: true, riskLevel: "low", issues: [] }, final: "早餐推荐燕麦坚果酥、全麦饼干和酸奶水果麦片，搭配牛奶饱腹感强，都是独立小包装方便携带。" },
  {
    q: "我想修改收货地址",
    risk: { passed: true, riskLevel: "low", issues: [] },
    final: "订单未出库前可以在「我的订单-详情」里直接修改地址，已出库的话请联系人工客服帮您拦截改地址哦。",
  },
  // 明确失败类
  {
    q: "query_products 工具一直报错",
    risk: { passed: true, riskLevel: "low", issues: [] },
    status: "failed", failedStepIdx: 1,
    failedStepRef: "query_products", failedStepType: "tool",
    failedStepError: "商品库连接失败：ETIMEDOUT 10.0.0.12:5432，已重试 3 次",
    final: "抱歉，商品查询服务暂时不可用，请稍后再试或联系客服。",
  },
  {
    q: "帮我生成一份月度零食采购清单（调用 response-generator 异常）",
    risk: { passed: true, riskLevel: "low", issues: [] },
    status: "failed", failedStepIdx: 7,
    failedStepRef: "response-generator", failedStepType: "skill",
    failedStepError: "模型连续 2 次返回非 JSON 文本，兜底回复为空",
    final: "抱歉，暂时无法为您生成清单，请换种方式描述您的需求。",
  },
  {
    q: "need-extraction 解析用户需求失败案例",
    risk: { passed: true, riskLevel: "low", issues: [] },
    degraded: true, failedStepIdx: 0,
    failedStepRef: "need-extraction", failedStepType: "skill",
    failedStepError: "模型返回结果中缺少 intent 字段，走默认 intent=other 兜底",
    final: "好的，我先按通用零食推荐帮您找一找。",
  },
];

const STEP_DEFS = [
  { ref: "need-extraction", desc: "结构化用户需求", type: "skill" as const },
  { ref: "query_products", desc: "按需求过滤商品", type: "tool" as const },
  { ref: "query_activities", desc: "查询优惠活动", type: "tool" as const },
  { ref: "query_coupons", desc: "查询可用优惠券", type: "tool" as const },
  { ref: "recommendation-decision", desc: "推荐决策", type: "skill" as const },
  { ref: "calculate_price", desc: "计算到手价", type: "tool" as const },
  { ref: "recommendation-reason", desc: "生成商品卖点", type: "skill" as const },
  { ref: "response-generator", desc: "生成客服话术", type: "skill" as const },
  { ref: "risk-check", desc: "风控审核", type: "skill" as const },
];

const runs: MockRun[] = [];
const now = Date.now();

scenarios.forEach((s, idx) => {
  const startedAt = new Date(now - idx * 3600_000 - Math.floor(Math.random() * 1800_000));
  let total = 0;
  const steps: MockRun["steps"] = [];
  let cursor = startedAt.getTime();
  STEP_DEFS.forEach((def, si) => {
    const base = def.type === "skill" ? 800 + Math.floor(Math.random() * 600) : 80 + Math.floor(Math.random() * 80);
    let status: "success" | "failed" | "degraded" | "error" = "success";
    let error: string | null = null;
    // 判断是否是失败的目标 step：按 ref 匹配优先，否则按 failedStepIdx
    const isFailed = (s.failedStepRef && s.failedStepRef === def.ref) || (!s.failedStepRef && s.failedStepIdx === si);
    if (isFailed) {
      if (s.degraded) { status = "degraded"; error = s.failedStepError || "依赖服务异常，使用兜底结果"; }
      else { status = "error"; error = s.failedStepError || "执行失败"; }
    }
    total += base;
    const tStart = new Date(cursor);
    const tEnd = new Date(cursor + base);
    cursor = tEnd.getTime();
    const io = buildStepIO(def.ref, s.q, s as any, isFailed);
    steps.push({
      stepIndex: si,
      step: si + 1,
      type: s.failedStepType && isFailed ? s.failedStepType : def.type,
      ref: isFailed && s.failedStepRef ? s.failedStepRef : def.ref,
      refName: def.desc,
      description: def.desc,
      status,
      error,
      durationMs: base,
      input: io.input,
      output: io.output,
      thinking: (io as any).thinking,
      startedAt: tStart.toISOString(),
      finishedAt: tEnd.toISOString(),
    });
  });

  const finishedAt = new Date(startedAt.getTime() + total);
  const riskResult = {
    passed: s.risk.passed,
    riskLevel: s.risk.riskLevel,
    level: s.risk.riskLevel,
    issues: (s.risk.issues || []).map((i) => (typeof i === "string" ? i : i.detail)),
  };
  runs.push({
    runId: `run_mock_${idx.toString().padStart(3, "0")}`,
    id: `run_mock_${idx.toString().padStart(3, "0")}`,
    source: "demo",
    userQuestion: s.q,
    question: s.q,
    plan: { reasoning: "兜底 9 步流程", steps: steps.map((st) => ({ step: st.step, type: st.type, ref: st.ref })) },
    finalReply: s.final,
    reply: s.final,
    risk: s.risk,
    riskResult,
    riskPassed: s.risk.passed,
    riskLevel: s.risk.riskLevel,
    status: s.status || (s.risk.passed ? "success" : "risk_blocked"),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    createdAt: startedAt.toISOString(),
    durationMs: total,
    handoffToHuman: s.handoff,
    handoffReason: s.handoff ? "高风险/客诉/售后，需人工介入" : undefined,
    handoffIssues: s.handoff
      ? (s.risk.issues || []).map((i) => (typeof i === "string" ? { type: "风险", detail: i } : { type: i.type, detail: i.detail }))
      : [],
    needsClarification: s.clarify,
    clarificationQuestion: s.clarify ? s.final : null,
    steps,
    isBadCase: !s.risk.passed && !s.handoff,
    tags: [s.handoff ? "handoff" : s.clarify ? "clarify" : s.degraded ? "degraded" : "success"],
  });
});

type MockRating = {
  id: string;
  conversationId: string;
  rating: number;
  score: number;
  question: string;
  reply: string;
  comment?: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
  isBadCase?: boolean;
};
const ratings: MockRating[] = [];
const ratingDist = [5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1];
const badComments = [
  "推荐的商品不太对胃口",
  "价格计算看不懂，再优化下",
  "答非所问，我问的是快递时效",
  "话术太生硬，像机器人",
  "活动没说清楚怎么叠加",
];
runs.forEach((r, idx) => {
  if (!r.riskPassed) return; // 只给风控通过的会话打分
  const score = ratingDist[idx % ratingDist.length];
  const userMsg = r.userQuestion || "";
  const assistantMsg = r.finalReply || r.reply || "";
  ratings.push({
    id: `rt_mock_${idx.toString().padStart(3, "0")}`,
    conversationId: r.runId,
    rating: score,
    score,
    question: userMsg,
    reply: assistantMsg,
    comment: score <= 3 ? badComments[idx % badComments.length] : undefined,
    messages: [
      { role: "user", content: userMsg },
      { role: "assistant", content: assistantMsg },
    ],
    createdAt: new Date(Date.parse(r.startedAt) + 60_000).toISOString(),
    isBadCase: score <= 2,
  });
});

fs.writeFileSync(path.join(DATA, "runs.json"), JSON.stringify({ runs }, null, 2), "utf8");
fs.writeFileSync(path.join(DATA, "ratings.json"), JSON.stringify({ ratings }, null, 2), "utf8");

// ---- Annotations（六维质量标注） ----
// 按预设意图挑选对应场景的 run，确保问题/标注对得上
function findRun(q: string): typeof runs[0] {
  const hit = runs.find((r) => (r.userQuestion || "").includes(q));
  if (!hit) throw new Error(`seed-mock: 找不到包含"${q}"的会话`);
  return hit;
}

const annotationPresets: Array<{
  questionKeyword: string;
  intent: string;
  riskLevel: "low" | "medium" | "high";
  qualityTags: string[];
  requiredCapabilities: string[];
  expectedFacts: string[];
  forbiddenPhrases: string[];
  scores: { correctness: number; relevance: number; completeness: number; safety: number; tone: number; overall: number };
  status: "pending" | "annotated" | "approved" | "rejected";
  note: string;
}> = [
  {
    questionKeyword: "100%",
    intent: "虚假宣传/绝对化承诺",
    riskLevel: "high",
    qualityTags: ["绝对化承诺", "安全风险"],
    requiredCapabilities: ["合规回复"],
    expectedFacts: ["不使用绝对化用语", "不承诺疗效"],
    forbiddenPhrases: ["绝对", "100%", "肯定", "保证"],
    scores: { correctness: 1, relevance: 2, completeness: 2, safety: 1, tone: 3, overall: 1 },
    status: "rejected",
    note: "回复出现'100%负责'绝对化承诺，违反广告法，必须拦截并驳回",
  },
  {
    questionKeyword: "减肥",
    intent: "虚假宣传/功效宣称",
    riskLevel: "high",
    qualityTags: ["夸大宣传", "功效宣称"],
    requiredCapabilities: ["合规回复", "健康声明禁止"],
    expectedFacts: ["零食不能减肥", "不做任何功效宣称"],
    forbiddenPhrases: ["减肥", "治疗", "越吃越瘦", "低卡瘦身"],
    scores: { correctness: 1, relevance: 2, completeness: 2, safety: 1, tone: 3, overall: 1 },
    status: "rejected",
    note: "产品含糖含油，回复称'低卡瘦身'属于虚假功效宣传，需重写",
  },
  {
    questionKeyword: "碎了",
    intent: "物流/破损售后",
    riskLevel: "medium",
    qualityTags: ["需转人工", "售后"],
    requiredCapabilities: ["售后安抚", "换货流程"],
    expectedFacts: ["先致歉", "告知换货流程", "3 个工作日处理"],
    forbiddenPhrases: [],
    scores: { correctness: 4, relevance: 4, completeness: 3, safety: 4, tone: 5, overall: 3 },
    status: "pending",
    note: "回复安抚到位，但缺具体换货流程入口，建议补全后批准",
  },
  {
    questionKeyword: "发货",
    intent: "物流时效咨询-信息不足",
    riskLevel: "low",
    qualityTags: ["需补信息"],
    requiredCapabilities: ["时效说明", "反问澄清"],
    expectedFacts: ["默认 2-3 个工作日送达", "偏远地区 3-5 天"],
    forbiddenPhrases: ["当天到", "保证明天到"],
    scores: { correctness: 3, relevance: 3, completeness: 2, safety: 4, tone: 4, overall: 3 },
    status: "pending",
    note: "未追问收货地址，默认回答 2-3 天可能不准确，建议补问地区后再给出时效",
  },
  {
    questionKeyword: "10 块钱",
    intent: "议价/活动咨询",
    riskLevel: "medium",
    qualityTags: ["能力缺失"],
    requiredCapabilities: ["议价应对", "活动介绍"],
    expectedFacts: ["引导到活动/优惠券", "婉拒议价"],
    forbiddenPhrases: ["肯定便宜", "全网最低", "最低价"],
    scores: { correctness: 3, relevance: 4, completeness: 4, safety: 4, tone: 4, overall: 3 },
    status: "pending",
    note: "议价类咨询需要引导到活动/券，直接承诺最低价容易违规",
  },
  {
    questionKeyword: "有什么好吃的",
    intent: "需求模糊-需反问澄清",
    riskLevel: "low",
    qualityTags: ["需反问澄清"],
    requiredCapabilities: ["意图识别", "反问槽位填充"],
    expectedFacts: ["反问偏好甜/咸", "询问预算与场景"],
    forbiddenPhrases: [],
    scores: { correctness: 4, relevance: 4, completeness: 4, safety: 5, tone: 5, overall: 4 },
    status: "approved",
    note: "反问清晰、语气友好，作为 golden case 候选",
  },
  {
    questionKeyword: "低糖",
    intent: "送礼场景-推荐",
    riskLevel: "low",
    qualityTags: ["场景化推荐优秀"],
    requiredCapabilities: ["礼盒识别", "场景化推荐"],
    expectedFacts: ["推荐低糖健康款", "告知礼盒包装", "到手价准确"],
    forbiddenPhrases: [],
    scores: { correctness: 4, relevance: 5, completeness: 4, safety: 5, tone: 5, overall: 4 },
    status: "approved",
    note: "推荐准确，但未提及礼盒加收 8 元，建议补全",
  },
  {
    questionKeyword: "满减",
    intent: "价格/优惠计算",
    riskLevel: "medium",
    qualityTags: ["价格错误", "优惠叠加"],
    requiredCapabilities: ["calculate_price", "满减叠加"],
    expectedFacts: ["使用 calculate_price 输出的 finalPrice", "不编造价格"],
    forbiddenPhrases: [],
    scores: { correctness: 2, relevance: 4, completeness: 3, safety: 4, tone: 4, overall: 3 },
    status: "rejected",
    note: "满减+优惠券叠加计算错误，必须强制走 calculate_price",
  },
  {
    questionKeyword: "保质期",
    intent: "商品信息-保质期",
    riskLevel: "low",
    qualityTags: ["信息缺失"],
    requiredCapabilities: ["保质期查询"],
    expectedFacts: ["告知保质期", "提示批次不同日期不同"],
    forbiddenPhrases: [],
    scores: { correctness: 3, relevance: 3, completeness: 3, safety: 4, tone: 4, overall: 3 },
    status: "pending",
    note: "未给出具体保质期查询方式，建议补入口",
  },
  {
    questionKeyword: "孩子",
    intent: "儿童零食推荐",
    riskLevel: "low",
    qualityTags: ["场景化优秀", "golden"],
    requiredCapabilities: ["年龄识别", "低糖推荐"],
    expectedFacts: ["推荐无添加果干/酸奶块", "提示家长注意食用安全"],
    forbiddenPhrases: [],
    scores: { correctness: 5, relevance: 5, completeness: 5, safety: 5, tone: 5, overall: 5 },
    status: "approved",
    note: "推荐准确、语气温柔，作为 golden case",
  },
];

const annotations: any[] = [];
annotationPresets.forEach((preset, i) => {
  const r = findRun(preset.questionKeyword);
  annotations.push({
    id: `ann_mock_${(i + 1).toString().padStart(3, "0")}`,
    runId: r.runId,
    sourceRunId: r.runId,
    question: r.userQuestion,
    reply: r.finalReply || r.reply || "",
    intent: preset.intent,
    riskLevel: preset.riskLevel,
    qualityTags: preset.qualityTags,
    requiredCapabilities: preset.requiredCapabilities,
    expectedFacts: preset.expectedFacts,
    forbiddenPhrases: preset.forbiddenPhrases,
    expectedReply: preset.status !== "approved"
      ? `【期望回复】识别意图为「${preset.intent}」，避免使用"${preset.forbiddenPhrases.join("/")}"等禁词，按 ${preset.expectedFacts.join("；")} 组织回复。`
      : undefined,
    scores: preset.scores,
    status: preset.status,
    annotatorNote: preset.note,
    createdAt: new Date(Date.parse(r.startedAt) + 90_000).toISOString(),
    updatedAt: new Date(Date.parse(r.startedAt) + 120_000).toISOString(),
  });
});

fs.writeFileSync(path.join(DATA, "annotations.json"), JSON.stringify({ annotations }, null, 2), "utf8");

// 加载 Skill 版本快照（独立脚本）
require("./seed-skill-versions");

console.log(`seeded ${runs.length} runs, ${ratings.length} ratings, ${annotations.length} annotations`);
