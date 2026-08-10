/**
 * seed-skill-versions.ts
 * 为 skills/ 目录下的核心 Skill 写入演示版本历史，让「运营中心-版本回滚」Tab 有数据可看。
 * 数据直接写入 data/skill-versions.json（与 skill-versions.ts 使用同一 schema：bySkillId 分组）。
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const VERSIONS_FILE = path.join(ROOT, "data", "skill-versions.json");

interface Version {
  id: string;
  skillId: string;
  body: string;
  message: string;
  createdAt: string;
  source: "seed" | "manual" | "patch" | "rollback";
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(end + 4).replace(/^\n/, "");
}

function readSkill(id: string): string | null {
  const p = path.join(SKILLS_DIR, id, "SKILL.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

/** 在 body 上按 anchor 行插入一段文本，生成模拟"补丁后"的版本 */
function patchAfter(body: string, anchor: string, insertText: string): string {
  const idx = body.indexOf(anchor);
  if (idx === -1) return body + "\n\n" + insertText;
  const end = body.indexOf("\n", idx);
  return body.slice(0, end + 1) + insertText + "\n" + body.slice(end + 1);
}

function genId() {
  return "v_" + randomUUID().slice(0, 10);
}

interface VersionTemplate {
  hoursAgo: number;
  source: Version["source"];
  message: string;
  /** 若提供，使用该 body（否则基于上一个 body 做 diff） */
  mutate?: (prev: string) => string;
}

const PLANS: Record<string, VersionTemplate[]> = {
  "need-extraction": [
    {
      hoursAgo: 72,
      source: "seed",
      message: "初始版本：基础意图识别",
      mutate: (b) =>
        b.replace(
          /## 输出字段[\s\S]*?(?=\n## |$)/,
          `## 输出字段
- intent: 用户意图
- categories: 商品品类
- flavorTags: 口味
- budget: 预算（数字或 null）
- scenario: 场景
- isNewUser: 是否新客（boolean）
`,
        ),
    },
    {
      hoursAgo: 48,
      source: "manual",
      message: "补充 flavorTags 枚举，覆盖麻辣/酸甜/低糖/无糖/原味",
      mutate: (b) =>
        patchAfter(
          b,
          "- flavorTags",
          "  可选值：麻辣/酸甜/低糖/无糖/原味/奶香/咸香/重辣/微辣；无法判断返回空数组",
        ),
    },
    {
      hoursAgo: 24,
      source: "patch",
      message: "AI 补丁：新增 giftPurpose 字段支持送礼场景",
      mutate: (b) =>
        patchAfter(
          b,
          "- isNewUser",
          "- giftPurpose: 送礼对象（children/elder/partner/friend/self，无法判断返回 null）",
        ),
    },
  ],
  "recommendation-decision": [
    {
      hoursAgo: 72,
      source: "seed",
      message: "初始版本：按 tag 匹配选 3 件",
    },
    {
      hoursAgo: 36,
      source: "manual",
      message: "限制预算超出商品直接过滤，避免推荐高于预算的产品",
      mutate: (b) =>
        patchAfter(
          b,
          "## 决策规则",
          "- 若商品原单价超过用户预算上限 120% 则直接剔除，不参与排序\n",
        ),
    },
    {
      hoursAgo: 12,
      source: "patch",
      message: "AI 补丁：新客优先推荐首单立减适用商品",
      mutate: (b) => b + "\n\n## 新客策略\n新客场景优先返回 `newUser=true` 活动可用的商品，并在 reason 中明确告知首单优惠。\n",
    },
    {
      hoursAgo: 2,
      source: "rollback",
      message: "回滚到「预算过滤」版本（新客策略导致非新客看不到经典商品）",
      mutate: (b) => b,
    },
  ],
  "recommendation-reason": [
    {
      hoursAgo: 60,
      source: "seed",
      message: "初始版本：每件商品 1 句卖点",
    },
    {
      hoursAgo: 20,
      source: "manual",
      message: "卖点必须包含一个具体口味/口感词，不允许泛泛而谈",
      mutate: (b) =>
        patchAfter(
          b,
          "## 输出要求",
          "- 每条卖点必须包含一个具体口味/口感形容词（Q 弹/酥脆/酸甜/软糯/爆汁/焦香等）\n",
        ),
    },
  ],
  "response-generator": [
    {
      hoursAgo: 80,
      source: "seed",
      message: "初始版本：简单问候+商品推荐",
    },
    {
      hoursAgo: 50,
      source: "manual",
      message: "价格必须显式使用 price.finalPrice，禁止四舍五入为整数",
      mutate: (b) =>
        patchAfter(
          b,
          "## 价格合规",
          "- 价格必须以 price.finalPrice 为准，保留一位小数，不允许写成「大概 10 元」「10 元左右」\n",
        ),
    },
    {
      hoursAgo: 18,
      source: "patch",
      message: "AI 补丁：增加反问澄清话术模板，避免生硬追问",
      mutate: (b) => b + "\n\n## 澄清模板\n当需求模糊时使用：「请问你更偏__（甜/咸）__一些吗？大概预算在__元左右？」\n",
    },
  ],
  "risk-check": [
    {
      hoursAgo: 90,
      source: "seed",
      message: "初始版本：基础禁词（最好/绝对/100%）",
    },
    {
      hoursAgo: 30,
      source: "manual",
      message: "补充「减肥/治病/药效」类医疗宣称拦截",
      mutate: (b) =>
        patchAfter(
          b,
          "## 禁词",
          "- 医疗宣称：减肥/瘦身/治病/降血压/药效/无副作用\n",
        ),
    },
  ],
  "after-sales-classification": [
    {
      hoursAgo: 60,
      source: "seed",
      message: "初始版本：支持退货/换货/补发/投诉4类基础分类",
    },
    {
      hoursAgo: 28,
      source: "manual",
      message: "补充「仅退款」场景分类（已签收未拆封）",
      mutate: (b) => b + "\n\n## 新增分类\n- refund_only: 用户已签收但未拆封，仅申请退款不退货，需引导上传商品照片后进入退款审批流\n",
    },
    {
      hoursAgo: 8,
      source: "patch",
      message: "AI 补丁：情感判断维度——愤怒/不满用户优先级最高",
      mutate: (b) =>
        patchAfter(
          b,
          "## 输出",
          "- urgency: 紧急度 1-3，含「愤怒/辱骂/投诉315」关键词强制返回 3\n",
        ),
    },
  ],
  "allergy-risk-reminder": [
    {
      hoursAgo: 50,
      source: "seed",
      message: "初始版本：花生/坚果/乳制品/海鲜4类常见过敏原识别",
    },
    {
      hoursAgo: 16,
      source: "manual",
      message: "新增芒果/麸质/大豆过敏原；儿童场景默认提示过敏原",
      mutate: (b) =>
        patchAfter(
          b,
          "## 过敏原",
          "- 高风险：花生/芒果/海鲜/乳制品/麸质/大豆；订单含 children 场景自动触发提示\n",
        ),
    },
  ],
  "clarification-question": [
    {
      hoursAgo: 55,
      source: "seed",
      message: "初始版本：需求模糊时反问口味/预算/场景3要素",
    },
    {
      hoursAgo: 20,
      source: "manual",
      message: "反问必须给候选项，不允许开放式提问（如「你喜欢什么」）",
      mutate: (b) => b + "\n\n## 反问原则\n每个反问必须提供 2-3 个候选答案，避免用户不知如何回答。例如：「你更偏麻辣还是酸甜一些？」而不是「你喜欢什么口味？」。\n",
    },
    {
      hoursAgo: 4,
      source: "patch",
      message: "AI 补丁：限制每次最多反问1个问题，避免连环追问",
      mutate: (b) =>
        patchAfter(
          b,
          "## 反问原则",
          "- 每次只反问 1 个最关键的问题，禁止一次问多个问题\n",
        ),
    },
  ],
  "complaint-triage": [
    {
      hoursAgo: 40,
      source: "seed",
      message: "初始版本：食品质量/物流/客服态度/价格纠纷4类分流",
    },
    {
      hoursAgo: 12,
      source: "manual",
      message: "新增「假货/过期」类投诉直接转人工，不允许自动回复",
      mutate: (b) =>
        patchAfter(
          b,
          "## 分流规则",
          "- 若出现「假货/过期/发霉/变质/吃了拉肚子」等安全相关投诉，directToHuman 必须为 true\n",
        ),
    },
  ],
  "conversation-summary": [
    {
      hoursAgo: 45,
      source: "seed",
      message: "初始版本：总结用户核心诉求+已推荐商品+待跟进事项",
    },
    {
      hoursAgo: 10,
      source: "manual",
      message: "摘要控制在100字以内，用于转人工后快速理解上下文",
      mutate: (b) =>
        patchAfter(
          b,
          "## 输出格式",
          "- summary 总长度不超过 100 字，突出「用户要什么/已给什么/还缺什么」\n",
        ),
    },
  ],
  "gift-scenario-advisor": [
    {
      hoursAgo: 65,
      source: "seed",
      message: "初始版本：情侣/父母/儿童/朋友4类送礼场景礼盒推荐",
    },
    {
      hoursAgo: 22,
      source: "manual",
      message: "新增节日场景：情人节/中秋/春节/圣诞自动匹配限定礼盒",
      mutate: (b) =>
        patchAfter(
          b,
          "## 场景识别",
          "- 节日场景：当前日期临近情人节/中秋/春节/圣诞时，优先推荐对应节日限定礼盒\n",
        ),
    },
    {
      hoursAgo: 6,
      source: "patch",
      message: "AI 补丁：价格梯度覆盖——按预算分低/中/高档各推一个礼盒",
      mutate: (b) => b + "\n\n## 价格梯度\n送礼场景必须按预算分三档：低档（预算70%）、中档（预算100%）、高档（预算130%），让用户有对比选择。\n",
    },
  ],
  "human-handoff-decision": [
    {
      hoursAgo: 35,
      source: "seed",
      message: "初始版本：用户明确说「转人工/找客服/投诉」时转人工",
    },
    {
      hoursAgo: 14,
      source: "manual",
      message: "补充情绪识别：连续两轮不满/出现辱骂词汇自动转人工",
      mutate: (b) =>
        patchAfter(
          b,
          "## 触发条件",
          "- 情绪触发：用户连续两轮表达不满，或出现辱骂/威胁/315/差评 等关键词时直接转人工\n",
        ),
    },
  ],
  "product-substitution": [
    {
      hoursAgo: 30,
      source: "seed",
      message: "初始版本：缺货时按同品类+同价位+高评分推荐替代",
    },
    {
      hoursAgo: 8,
      source: "manual",
      message: "替代商品必须说明「与原商品差异」，不允许直接推不相似商品",
      mutate: (b) => b + "\n\n## 替换说明\n返回替代商品时必须在 reason 中明确说明：「这款和你想要的 XX 相比，口味更__（淡/浓）__，价位__（相同/略低/略高）__」。\n",
    },
  ],
};

function buildVersions(): Record<string, Version[]> {
  const result: Record<string, Version[]> = {};
  for (const [skillId, plans] of Object.entries(PLANS)) {
    const raw = readSkill(skillId);
    if (!raw) {
      console.warn(`[seed-skill-versions] skill not found: ${skillId}`);
      continue;
    }
    const body = stripFrontmatter(raw);
    // 从最旧到最新生成；第一个是"初始版本"，后面用 mutate 改动
    const versions: Version[] = [];
    // 初始版本的 body = seed 之前最原始的状态：去掉最后一次 manual/patch 的影响
    // 这里简单：从当前 body 反向构建——按时间从旧到新
    const sorted = [...plans].sort((a, b) => b.hoursAgo - a.hoursAgo);
    // 第一版 = seed 版本（如果 seed.mutate 存在，则从当前 body 反向还原复杂，我们直接用 mutate 过的"旧版本"）
    let curBody = body;
    for (const p of sorted) {
      // 从新到旧构造时，我们用 mutate 在 curBody 上打补丁生成"那个时间点的版本"
      // 但因为我们要从旧→新，这里先简单：初始用 curBody，后续用 mutate 叠加
      versions.push({
        id: genId(),
        skillId,
        body: curBody,
        message: p.message,
        createdAt: hoursAgo(p.hoursAgo),
        source: p.source,
      });
      if (p.mutate) {
        curBody = p.mutate(curBody);
      }
    }
    // 最前面再加一条"当前"版本（manual，0 小时前），内容 = 当前 SKILL.md body
    versions.unshift({
      id: genId(),
      skillId,
      body,
      message: "当前生效版本",
      createdAt: hoursAgo(0),
      source: "manual",
    });
    result[skillId] = versions;
  }
  return result;
}

function main() {
  let existing: { bySkillId: Record<string, Version[]> } = { bySkillId: {} };
  if (fs.existsSync(VERSIONS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(VERSIONS_FILE, "utf-8"));
      if (!existing.bySkillId) existing = { bySkillId: {} };
    } catch {
      existing = { bySkillId: {} };
    }
  }
  const seeded = buildVersions();
  for (const [sid, vs] of Object.entries(seeded)) {
    // 不覆盖已经存在的版本（之前手动保存的）
    if (!existing.bySkillId[sid] || existing.bySkillId[sid].length === 0) {
      existing.bySkillId[sid] = vs;
    } else {
      // 追加 seed 版本（用 seed source 标记），保留已有版本
      const seededIds = new Set(existing.bySkillId[sid].map((v) => v.id));
      for (const v of vs) {
        if (!seededIds.has(v.id)) existing.bySkillId[sid].push(v);
      }
      // 按时间倒序
      existing.bySkillId[sid].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      );
    }
  }
  fs.writeFileSync(VERSIONS_FILE, JSON.stringify(existing, null, 2), "utf-8");
  const total = Object.values(existing.bySkillId).reduce(
    (s, arr) => s + arr.length,
    0,
  );
  console.log(
    `[seed-skill-versions] wrote ${Object.keys(existing.bySkillId).length} skills, ${total} versions total`,
  );
}

main();
