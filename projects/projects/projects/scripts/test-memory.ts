/**
 * 长期记忆回归脚本
 *
 * 覆盖：visitorId 边界校验、敏感信息脱敏、新客身份翻转、同类事实淘汰、
 *       过敏事实归类、畸形画像容错、seed 幂等且不误删真实画像
 * 用法：pnpm tsx scripts/test-memory.ts   或   pnpm memory:test
 * 退出码 0 = 全绿；任何一项失败返回 1，可直接用于课前自检。
 *
 * 说明：强制 classroom-fixture（演示稳定模式），不依赖网络与密钥，结果确定；
 *       所有测试画像用 cu_zztest_ 前缀，跑完自动清理。
 */
process.env.LLM_PROVIDER = "classroom-fixture";

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { atomicWriteTextSync } from "../src/lib/fs-atomic";
import { toMemoryInfo } from "../src/lib/memory-view";
import {
  buildMemoryContext,
  deleteProfile,
  emptyProfile,
  readProfile,
  sanitizeVisitorId,
  updateMemoryAfterRun,
  writeProfile,
} from "../src/lib/memory";

// 与项目其它脚本一致：根目录由脚本位置推导，不依赖调用时的 pwd
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILES_DIR = path.join(PROJECT_ROOT, "data", "memory", "profiles");
const RUN_ID = "run_zztest_0001";

const ID = {
  pii: "cu_zztest_pii",
  afterSales: "cu_zztest_aftersales",
  rebuy: "cu_zztest_rebuy",
  intent: "cu_zztest_intent",
  restock: "cu_zztest_restock",
  cap: "cu_zztest_cap",
  allergyImplicit: "cu_zztest_allergy_implicit",
  allergyExplicit: "cu_zztest_allergy_explicit",
  broken: "cu_zztest_broken",
  live: "cu_zztest_live",
};
const SEEDED_IDS = [
  "cu_wangmeili", "cu_lihao", "cu_zhangwei", "cu_chenxi",
  "cu_zhaomin", "cu_sunqing", "cu_zhouqiang", "cu_linyi",
];

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `  ← ${detail}` : ""}`);
  }
}

/** 读取 seed 画像的 interactionCount，用于验证 seed 可复现 */
function seededCounts(): number[] {
  return SEEDED_IDS.map((id) => {
    const p = readProfileSync(id);
    return p?.interactionCount ?? -1;
  });
}

function readProfileSync(visitorId: string): { interactionCount?: number } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, `${visitorId}.json`), "utf-8"));
  } catch {
    return null;
  }
}

async function extract(visitorId: string, question: string, finalReply = "好的，已为您安排～") {
  return updateMemoryAfterRun({ visitorId, runId: RUN_ID, input: { question, finalReply } });
}

async function main() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  // 备份现有画像：修复前的 seed 会误删真实画像，跑完负责恢复
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-mem-backup-"));
  for (const f of fs.readdirSync(PROFILES_DIR)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(PROFILES_DIR, f), path.join(backupDir, f));
  }

  try {
    console.log("\n[1] visitorId 边界校验（防目录穿越 / Windows 保留设备名 / 超长）");
    check("拒绝 Windows 保留设备名 con", sanitizeVisitorId("con") === "");
    check("拒绝 Windows 保留设备名 CON（大小写不敏感）", sanitizeVisitorId("CON") === "");
    check("拒绝 Windows 保留设备名 nul", sanitizeVisitorId("nul") === "");
    check("拒绝目录穿越 ../../etc/passwd", sanitizeVisitorId("../../etc/passwd") === "");
    check("拒绝超长 visitorId（>64）", sanitizeVisitorId("a".repeat(200)) === "");
    check("拒绝非字符串入参", sanitizeVisitorId(123) === "");
    check("保留合法 visitorId 原样", sanitizeVisitorId("cu_abc-123") === "cu_abc-123");
    check("非法 id 读取画像不抛错", (await readProfile("con")) === null);

    console.log("\n[2] 敏感信息脱敏（手机号 / 地址不落盘、不进事实）");
    const piiQuestion = "我家地址是北京市朝阳区幸福路18号3单元502，手机13812345678，帮我推荐零食";
    const piiResult = await extract(ID.pii, piiQuestion);
    const piiProfile = await readProfile(ID.pii);
    const piiBlob = JSON.stringify(piiProfile ?? {});
    const piiFile = fs.existsSync(path.join(PROFILES_DIR, `${ID.pii}.json`))
      ? fs.readFileSync(path.join(PROFILES_DIR, `${ID.pii}.json`), "utf-8")
      : "";
    check("提取走确定性规则兜底（循环可复现）", piiResult?.usedFallback === true);
    check("手机号不写入画像", !piiBlob.includes("13812345678"), "画像 JSON 仍含手机号");
    check("地址门牌不写入画像", !piiBlob.includes("幸福路18号"), "画像 JSON 仍含门牌");
    check("磁盘文件内无手机号", !piiFile.includes("13812345678"));
    check("交互轨迹 question 已脱敏", !(piiProfile?.episodes?.[0]?.question ?? "").includes("13812345678"));
    check("交互摘要不含敏感信息", !(piiProfile?.episodes?.[0]?.summary ?? "").includes("13812345678"));
    check("稳定事实不含敏感信息", !(piiProfile?.facts ?? []).some((f) => /13812345678|幸福路/.test(f.content)));

    console.log("\n[3] 新客身份翻转（售后咨询不得翻转，明确复购必须翻转）");
    await extract(ID.afterSales, "我上周买的订单号是多少？物流怎么还没到");
    check("售后/查单咨询不翻转新客身份", (await readProfile(ID.afterSales))?.isNewUser === true);
    await extract(ID.rebuy, "我又来回购两包魔芋爽，帮我下单");
    check("明确复购仍翻转为老客", (await readProfile(ID.rebuy))?.isNewUser === false);
    await extract(ID.intent, "周末追剧想囤点麻辣零食，预算40元");
    check("购买意向（想囤点）不翻转新客身份", (await readProfile(ID.intent))?.isNewUser === true);
    await extract(ID.restock, "上次买的魔芋爽吃完了，再囤两包");
    check("老客补货（再囤）仍翻转为老客", (await readProfile(ID.restock))?.isNewUser === false);

    console.log("\n[4] 同类事实满额（≤8）时淘汰最旧、保留新事实");
    const cap = emptyProfile(ID.cap);
    cap.interactionCount = 5;
    cap.facts = Array.from({ length: 8 }, (_, i) => ({
      kind: "preference" as const,
      content: `偏好测试口味${i + 1}`,
      updatedAt: new Date(Date.now() - (8 - i) * 60000).toISOString(),
    }));
    await writeProfile(cap);
    await extract(ID.cap, "我爱吃麻辣的");
    const capProfile = await readProfile(ID.cap);
    check("新事实在同类满额时仍被记住", (capProfile?.facts ?? []).some((f) => f.content === "偏好麻辣口味"));
    check("同类事实不超过 8 条", (capProfile?.facts ?? []).filter((f) => f.kind === "preference").length <= 8);
    check("被淘汰的是最旧一条", !(capProfile?.facts ?? []).some((f) => f.content === "偏好测试口味1"));
    check("交互次数正常累加", capProfile?.interactionCount === 6);

    console.log("\n[5] 过敏事实（不得写残句，须归类为 restriction）");
    await extract(ID.allergyImplicit, "吃这些会不会过敏啊？");
    const allergyImplicit = await readProfile(ID.allergyImplicit);
    check("过敏事实不含残句", !(allergyImplicit?.facts ?? []).some((f) => /会不会|过敏信息：/.test(f.content)));
    check("过敏事实归类为 restriction", (allergyImplicit?.facts ?? []).every((f) => !f.content.includes("过敏") || f.kind === "restriction"));
    await extract(ID.allergyExplicit, "我对芒果过敏，别给我推荐芒果味的");
    const allergyExplicit = await readProfile(ID.allergyExplicit);
    check(
      "过敏原写进 restriction 事实",
      (allergyExplicit?.facts ?? []).some((f) => f.kind === "restriction" && f.content.includes("芒果")),
    );

    console.log("\n[6] 畸形画像文件容错（外部编辑后 /memory 页不应 500）");
    atomicWriteTextSync(
      path.join(PROFILES_DIR, `${ID.broken}.json`),
      JSON.stringify({ visitorId: ID.broken, isNewUser: false }),
    );
    const broken = await readProfile(ID.broken);
    check(
      "缺失字段被归一化为默认值",
      !!broken && Array.isArray(broken.facts) && Array.isArray(broken.episodes) && broken.interactionCount === 0,
    );
    check("归一化后仍可注入召回上下文", typeof buildMemoryContext(broken) === "string");

    console.log("\n[7] seed 脚本（幂等可复现、不误删真实画像）");
    const live = emptyProfile(ID.live);
    live.interactionCount = 3;
    await writeProfile(live);
    execSync("pnpm memory:seed", { cwd: PROJECT_ROOT, stdio: "pipe" });
    check("seed 后真实画像仍在", fs.existsSync(path.join(PROFILES_DIR, `${ID.live}.json`)));
    const firstRun = seededCounts();
    execSync("pnpm memory:seed", { cwd: PROJECT_ROOT, stdio: "pipe" });
    const secondRun = seededCounts();
    check("seed 写出全部 8 个演示画像", firstRun.every((n) => n > 0), `实际 ${JSON.stringify(firstRun)}`);
    check("seed 两次运行结果一致（可复现）", JSON.stringify(firstRun) === JSON.stringify(secondRun), `${JSON.stringify(firstRun)} vs ${JSON.stringify(secondRun)}`);

    console.log("\n[8] 展示层映射（画像 episodes 与 SSE recentEpisodes 两种形状）");
    const fromProfile = toMemoryInfo({
      interactionCount: 2,
      isNewUser: false,
      facts: [{ kind: "preference", content: "喜欢麻辣口味零食" }],
      episodes: [{ summary: "老客回购辣味魔芋爽", ts: "2026-09-24T00:00:00.000Z" }],
    });
    check("画像 episodes 能映射出「上次交互」摘要", fromProfile?.recentEpisodes?.[0]?.summary === "老客回购辣味魔芋爽");
    const fromEvent = toMemoryInfo({ interactionCount: 3, recentEpisodes: [{ summary: "事件里的摘要", ts: "t" }] });
    check("SSE recentEpisodes 形状同样可用", fromEvent?.recentEpisodes?.[0]?.summary === "事件里的摘要");
    check("无数据时返回 null（面板不渲染）", toMemoryInfo(null) === null && toMemoryInfo(undefined) === null);
  } finally {
    for (const id of Object.values(ID)) {
      await deleteProfile(id).catch(() => {});
    }
    for (const f of fs.readdirSync(backupDir)) {
      const target = path.join(PROFILES_DIR, f);
      if (!fs.existsSync(target)) {
        atomicWriteTextSync(target, fs.readFileSync(path.join(backupDir, f), "utf-8"));
      }
    }
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`);
  if (failures.length) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

void main();
