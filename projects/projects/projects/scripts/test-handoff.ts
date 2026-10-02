/**
 * 坐席代笔（A2）回归脚本
 *
 * 覆盖：转人工确定性触发、接管话术不覆盖已有回复、候选生成（fixture 确定性）、候选归一化与脱敏、
 *       场景分支差异化、以及「未选择不能标记发送」的语义由 API 层保证（见 PRD §8/§11）
 * 用法：pnpm handoff:test
 * 退出码 0 = 全绿，可直接用于课前自检。
 *
 * 说明：本脚本在进程内跑 fixture（演示稳定模式），不依赖网络、密钥与运行中的服务。
 *       API 级（400/404、留痕落库）与浏览器端流程已在开发过程中实测，见 05-项目支撑审计.md。
 */
process.env.LLM_PROVIDER = "classroom-fixture";

import { generatePlan } from "../src/lib/planner";
import { executePlan } from "../src/lib/executor";
import { listEnabledSkills } from "../src/lib/skills-registry";
import { listToolConfigs } from "../src/lib/store";
import { detectHandoffSignals } from "../src/lib/handoff-rules";
import { buildDraftContext, draftCandidates, normalizeCandidates, templateCandidates } from "../src/lib/draft-candidates";
import type { RunRecord } from "../src/lib/store";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `  ← ${detail}` : ""}`);
  }
};

const COMPLAINT = "你们的零食里吃出头发了，我要投诉！必须给我赔偿";
const NORMAL = "有什么办公室零食推荐吗，预算30元";

async function runPipeline(question: string) {
  const availableSkills = listEnabledSkills().map((s) => s.id);
  const availableTools = (await listToolConfigs()).filter((t) => t.enabled).map((t) => t.id);
  const plan = await generatePlan({ question });
  return executePlan({ plan, question, availableSkills, availableTools });
}

async function main() {
  console.log("\n[1] 转人工确定性触发（不依赖模型自觉）");
  check("投诉/赔偿/异物被识别为转人工信号", detectHandoffSignals(COMPLAINT).length >= 2, JSON.stringify(detectHandoffSignals(COMPLAINT)));
  check("普通咨询不触发转人工信号", detectHandoffSignals(NORMAL).length === 0);

  const complaintRun = await runPipeline(COMPLAINT);
  check("投诉会话被标记待人工", complaintRun.handoffToHuman === true);
  check("给出转人工原因", !!complaintRun.handoffReason, String(complaintRun.handoffReason));
  check("计划未被改写（仍为 9 步兜底计划）", complaintRun.steps.length === 9, `实际 ${complaintRun.steps.length} 步`);
  check(
    "接管话术不覆盖 AI 已生成的回复",
    !!complaintRun.finalReply && !complaintRun.finalReply.includes("已帮您转接人工客服"),
    String(complaintRun.finalReply).slice(0, 30),
  );

  const normalRun = await runPipeline(NORMAL);
  check("普通会话不被标记待人工", !normalRun.handoffToHuman);

  console.log("\n[2] 候选生成（fixture 确定性）");
  const runRecord = {
    runId: "run_zztest_handoff",
    source: "user",
    question: COMPLAINT,
    finalReply: complaintRun.finalReply,
    plan: { steps: [] },
    steps: [],
    handoffToHuman: true,
    handoffReason: "命中转人工关键词：投诉、赔偿、头发",
    startedAt: new Date().toISOString(),
    durationMs: 1,
    status: "success",
  } as unknown as RunRecord;

  const first = await draftCandidates(runRecord);
  const second = await draftCandidates(runRecord);
  check("生成 3 条候选", first.candidates.length === 3, `实际 ${first.candidates.length}`);
  check("三条策略互不相同", new Set(first.candidates.map((c) => c.style)).size === 3);
  check("每条都有风险标注与等级", first.candidates.every((c) => c.riskNote.length > 0 && ["low", "medium", "high"].includes(c.riskLevel)));
  check("fixture 模式标记为模板兜底", first.usedFallback === true);
  check("两次生成结果一致（确定性）", JSON.stringify(first.candidates) === JSON.stringify(second.candidates));
  check("候选不含禁词", !first.candidates.some((c) => /绝对|100%|包退|包赔|保证/.test(c.content)));

  console.log("\n[3] 候选归一化与隐私");
  const normalized = normalizeCandidates([
    { id: "c1", style: "正常", content: "这是一条正常长度的候选话术，可以直接使用。", riskNote: "无", riskLevel: "low" },
    { id: "c2", style: "超短", content: "太短", riskNote: "", riskLevel: "low" },
    { id: "c3", style: "越权等级", content: "这条候选的等级字段是乱写的值，应归一为 low。", riskNote: "无", riskLevel: "blocker" },
    { id: "c4", style: "含敏感信息", content: "请联系我 13812345678 确认细节", riskNote: "无", riskLevel: "low" },
  ]);
  check("过短条目被丢弃", !normalized.some((c) => c.style === "超短"));
  check("非法风险等级归一为 low", normalized.find((c) => c.style === "越权等级")?.riskLevel === "low");
  check("含手机号的候选整条丢弃", !normalized.some((c) => c.content.includes("13812345678")) && !normalized.some((c) => c.style === "含敏感信息"));
  check("候选 id 唯一且重排为 c1..cN", normalized.every((c, i) => c.id === `c${i + 1}`), JSON.stringify(normalized.map((c) => c.id)));
  check("合法候选保留", normalized.some((c) => c.style === "正常"));

  console.log("\n[4] 场景分支（模板兜底的差异化）");
  const scenes: Array<[string, string, string]> = [
    ["投诉", "我要投诉你们客服态度差", "投诉安抚"],
    ["退款", "这单我要退货退款", "退款退货"],
    ["物流", "快递三天没动了，物流怎么回事", "物流异常"],
    ["过敏", "吃了你们的东西过敏了，身上起疹子", "过敏/食品安全"],
  ];
  for (const [label, question, expectLabel] of scenes) {
    const ctx = buildDraftContext({ ...runRecord, question, handoffReason: "演示" } as unknown as RunRecord);
    const cands = templateCandidates(ctx);
    check(`${label}场景命中「${expectLabel}」分支`, cands.every((c) => c.style.includes(expectLabel)), cands[0]?.style);
  }
}

void main().then(() => {
  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`);
  if (failures.length) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
});
