/**
 * 能力对账脚本（课前自查用）
 *
 * 为什么需要它：Planner 会**静默丢弃**引用不存在或未启用能力的步骤
 * （见 planner.ts 的 validSteps 过滤），所以"计划里少了一步"不会报错，
 * 只会在执行轨迹里表现为 skipped。课程规则要求不得编造已实现功能，
 * 因此每次改技能 / 工具 / Planner 提示词后都要能一次性核对。
 *
 * 检查项：
 *   硬性（不通过则退出码 1）
 *   1) skills/<id>/SKILL.md 都能解析，且 id 唯一
 *   2) planner.fallbackPlan() 引用的能力全部存在且启用
 *   3) Planner 提示词里点名要求调用的能力（能识别为能力 id 的那些）必须存在且启用
 *   4) tools-config.json 未登记的工具按 store.ts 的 DEFAULT_TOOLS 取默认启停（脚本会列出，便于人工核对）
 *   提示（不影响退出码）
 *   5) 前端步骤标签（demo-chat STEP_LABEL）里无法解析的 ref
 *   6) Planner 提示词里疑似能力 id 但未注册的词（需人工判断是普通词还是真缺失）
 *
 * 用法：pnpm audit:capabilities
 */
import fs from "fs";
import path from "path";
import { fallbackPlan, readPlannerConfig } from "../src/lib/planner";
import { listSkills } from "../src/lib/skills-registry";
import { getToolCatalog } from "../src/lib/tools";
import { listToolConfigs } from "../src/lib/store";

const ROOT = path.resolve(__dirname, "..");

/** 这些词长得像能力 id，但不是能力（模型名、文件名、配置项），对账时忽略 */
const NOT_CAPABILITIES = new Set([
  "doubao-seed-2-0-lite-260215",
  "doubao-seed-2-0-mini-260215",
  "doubao-seed-1-8-251228",
  "deepseek-chat",
  "deepseek-v4-pro",
  "gpt-4o-mini",
  "planner-config",
  "llm-config",
  "tools-config",
  "fs-atomic",
  "utf-8",
  "openai-compatible",
  "classroom-fixture",
]);

const failures: string[] = [];
const warnings: string[] = [];
const fail = (msg: string) => failures.push(msg);
const warn = (msg: string) => warnings.push(msg);

/**
 * 提取疑似能力 id。技能 id 用连字符（need-extraction），工具 id 用下划线（query_order），
 * 两种都要覆盖——只匹配连字符会漏掉全部工具，正是"提示词点名了被禁用的工具"这类问题。
 */
const idTokens = (text: string) =>
  [...new Set([...text.matchAll(/\b[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+\b/g)].map((m) => m[0]))];

async function main() {
  const skills = listSkills();
  const skillIds = new Set(skills.map((s) => s.id));
  const enabledSkillIds = new Set(skills.filter((s) => s.enabled).map((s) => s.id));
  const catalogIds = new Set(getToolCatalog().map((t) => t.id));
  const toolConfigs = await listToolConfigs();
  const enabledToolIds = new Set(toolConfigs.filter((t) => t.enabled).map((t) => t.id));
  const resolves = (id: string) => skillIds.has(id) || catalogIds.has(id);
  const enabled = (id: string) => enabledSkillIds.has(id) || enabledToolIds.has(id);

  console.log(`技能注册表：${skills.length} 个（启用 ${enabledSkillIds.size}）`);
  console.log(`工具注册表：${catalogIds.size} 个（启用 ${enabledToolIds.size}）`);

  // 1) 注册表完整性
  if (skillIds.size !== skills.length) {
    fail("skills/ 目录下存在重复的技能 id（frontmatter id 冲突）");
  }
  const disabled = skills.filter((s) => !s.enabled).map((s) => s.id);
  if (disabled.length) console.log(`未启用的技能：${disabled.join("、")}`);
  const disabledTools = toolConfigs.filter((t) => !t.enabled).map((t) => t.id);
  console.log(`未启用的工具：${disabledTools.join("、") || "（无）"}`);

  // 2) fallbackPlan 引用
  for (const step of fallbackPlan().steps) {
    if (!resolves(step.ref)) fail(`fallbackPlan 引用了未注册的能力：${step.type} ${step.ref}`);
    else if (!enabled(step.ref)) fail(`fallbackPlan 引用了未启用的能力：${step.type} ${step.ref}`);
  }
  console.log(`fallbackPlan：${fallbackPlan().steps.length} 步，全部可解析：${
    fallbackPlan().steps.every((s) => enabled(s.ref)) ? "是" : "否"
  }`);

  // 3) Planner 提示词里点名的能力（技能用连字符、工具用下划线，两种都要认）
  const plannerPrompt = readPlannerConfig().systemPrompt;
  const named = idTokens(plannerPrompt).filter((t) => !NOT_CAPABILITIES.has(t));
  const namedResolved = named.filter(resolves);
  const namedUnknown = named.filter((t) => !resolves(t));
  for (const id of namedResolved) {
    if (!enabled(id)) fail(`Planner 提示词点名要求使用的 ${id} 未启用（计划会被静默丢弃）`);
  }
  console.log(`Planner 提示词提及能力 ${namedResolved.length} 个，均已启用：${
    namedResolved.every(enabled) ? "是" : "否"
  }`);

  // 4) 工具启停的配置覆盖情况。
  //    注意：listToolConfigs() 读取时会把 store.ts 的 DEFAULT_TOOLS 合并进来，
  //    所以"配置文件里没有"不等于"未启用"——这里直接读原始文件，说清每个工具的启停来源。
  const rawToolConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tools-config.json"), "utf-8"));
  const rawIds = new Set<string>((rawToolConfig.tools ?? []).map((t: { id: string }) => t.id));
  const fromDefaults = [...catalogIds].filter((id) => !rawIds.has(id));
  if (fromDefaults.length) {
    console.log(
      `tools-config.json 未登记、按 store.ts 的 DEFAULT_TOOLS 取默认启停的工具：${fromDefaults.join("、")}`,
    );
  }
  for (const t of toolConfigs) {
    if (!catalogIds.has(t.id)) warn(`tools-config.json 里的 ${t.id} 在 src/lib/tools.ts 已无实现`);
  }

  // 5) 前端步骤标签
  const demoChat = fs.readFileSync(path.join(ROOT, "src/components/demo-chat.tsx"), "utf-8");
  const labelBlock = demoChat.match(/const STEP_LABEL[^{]*\{([\s\S]*?)\n\s*\};/);
  const labelKeys = labelBlock ? [...labelBlock[1].matchAll(/"([a-z0-9_-]+)"\s*:/g)].map((m) => m[1]) : [];
  const staleLabels = labelKeys.filter((k) => !resolves(k));
  if (staleLabels.length) warn(`前端步骤标签里的 ref 已无法解析（只影响显示名）：${staleLabels.join("、")}`);
  console.log(`前端步骤标签：${labelKeys.length} 个，未解析 ${staleLabels.length} 个`);

  // 6) 提示词里的疑似能力 id
  if (namedUnknown.length) {
    console.log(`\nPlanner 提示词里未注册的疑似能力 id（请人工确认是普通词还是真缺失）：`);
    console.log(`  ${namedUnknown.join("、")}`);
  }

  console.log("");
  if (warnings.length) {
    console.log(`提示 ${warnings.length} 条：`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (failures.length) {
    console.log(`对账失败 ${failures.length} 条：`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log("对账通过：计划可引用的能力与实际注册/启停一致。");
  }
}

void main();
