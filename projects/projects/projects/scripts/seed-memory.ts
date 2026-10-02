/**
 * 记忆库演示数据种子脚本
 *
 * 数据来源类别：**合成数据（非真实用户）**，专门为课堂演示准备，不含真实个人信息。
 * 用途：为「记忆管理」页(/memory)与前台「AI 记住了你」面板准备一批有真实感的访客画像。
 * 生成方式：脚本内置固定画像（口味/忌口/预算/身份），时间戳相对运行时刻生成，重跑即刷新。
 * 字段：visitorId / createdAt / updatedAt / isNewUser / interactionCount / facts[] / episodes[]
 * 已知限制：非真实用户行为；interactionCount 为演示取值，不是真实统计口径。
 *
 * 幂等与安全：只覆盖本脚本自己声明的 8 个演示 visitorId；**不会删除其他画像**
 * （真实访客产生的画像、以及 cu_4n6p34jamu7u7y6m 这类运行产物都保留）。
 * 写入走 fs-atomic（项目持久化红线）。
 *
 * 用法：pnpm memory:seed   或   pnpm tsx scripts/seed-memory.ts
 */
import path from "path";
import { atomicWriteText } from "../src/lib/fs-atomic";

// 与项目其它脚本一致：根目录由脚本位置推导，不依赖调用时的 pwd
const root = path.resolve(__dirname, "..");
const profilesDir = path.join(root, "data", "memory", "profiles");

/** 天数偏移 → ISO 时间戳（相对脚本运行时刻，让演示数据始终"最近"） */
const daysAgo = (d: number, hour = 10, min = 0) => {
  const t = new Date(Date.now() - d * 24 * 3600 * 1000);
  t.setHours(hour, min, 0, 0);
  return t.toISOString();
};
/** 生成演示用的假 runId（形如 run_seed12c84，带上序号避免重复） */
const demoRunId = (n: number) => `run_seed${n}${String.fromCharCode(97 + (n % 26))}${n * 7}`;

type FactKind = "preference" | "restriction" | "identity" | "budget" | "scenario" | "other";

interface SeedProfile {
  visitorId: string;
  isNewUser: boolean;
  facts: Array<{ kind: FactKind; content: string }>;
  episodes: Array<{ question: string; summary: string; products?: string[] }>;
  episodeTimes: number[];
}

const PROFILES: SeedProfile[] = [
  {
    visitorId: "cu_wangmeili",
    isNewUser: false,
    facts: [
      { kind: "preference", content: "喜欢麻辣口味零食" },
      { kind: "preference", content: "偏好魔芋类脆弹口感" },
      { kind: "scenario", content: "常在办公室吃零食" },
      { kind: "budget", content: "零食预算约30元" },
      { kind: "identity", content: "老客，多次复购辣味魔芋爽" },
    ],
    episodes: [
      { question: "上次买的魔芋爽吃完了，再囤两包", summary: "老客回购辣味魔芋爽，一次买了两包", products: ["辣味魔芋爽"] },
      { question: "办公室下午馋了，有没有麻辣味的推荐", summary: "推荐辣味魔芋爽，用户预算30元内满意下单", products: ["辣味魔芋爽"] },
      { question: "我想买点办公室零食，要麻辣口味的，预算30元左右", summary: "首次咨询办公室麻辣零食，客服推荐魔芋爽", products: ["辣味魔芋爽"] },
    ],
    episodeTimes: [2, 9, 16],
  },
  {
    visitorId: "cu_lihao",
    isNewUser: true,
    facts: [
      { kind: "scenario", content: "有送礼需求（送女朋友）" },
      { kind: "budget", content: "送礼预算150-200元" },
    ],
    episodes: [
      { question: "我是新客，有没有适合送女朋友的礼盒推荐？", summary: "新客咨询送女朋友的礼盒，预算150-200元", products: ["坚果礼盒", "巧克力礼盒"] },
    ],
    episodeTimes: [1],
  },
  {
    visitorId: "cu_zhangwei",
    isNewUser: false,
    facts: [
      { kind: "restriction", content: "孩子对花生过敏，需避开花生成分" },
      { kind: "scenario", content: "常给孩子买零食" },
      { kind: "budget", content: "预算约20元" },
      { kind: "identity", content: "老客，孩子零食常购用户" },
    ],
    episodes: [
      { question: "小孩能吃的糖果再买两袋，别有花生的", summary: "老客复购儿童糖果，再次强调避开花生成分", products: ["水果软糖"] },
      { question: "有没有适合小孩吃的糖果？预算20元，孩子花生过敏", summary: "首咨儿童糖果，标记花生过敏禁忌", products: ["水果软糖"] },
    ],
    episodeTimes: [4, 12],
  },
  {
    visitorId: "cu_chenxi",
    isNewUser: true,
    facts: [
      { kind: "restriction", content: "孕期用户，需注意食品安全" },
      { kind: "preference", content: "偏好无糖/低糖零食" },
      { kind: "budget", content: "预算约50元" },
    ],
    episodes: [
      { question: "我想买点健康的小零食，预算50元，孕妇能吃的", summary: "孕妈咨询无糖低糖健康零食，已做安全提示", products: ["无糖坚果"] },
    ],
    episodeTimes: [3],
  },
  {
    visitorId: "cu_zhaomin",
    isNewUser: false,
    facts: [
      { kind: "preference", content: "常买坚果类" },
      { kind: "scenario", content: "追剧场景吃零食" },
      { kind: "budget", content: "预算约40元" },
      { kind: "identity", content: "老客，每周复购每日坚果" },
    ],
    episodes: [
      { question: "周末追剧囤点货，还是老样子每日坚果", summary: "老客复购每日坚果，追剧囤货", products: ["每日坚果"] },
      { question: "追剧想嗑点坚果，有推荐的吗", summary: "推荐每日坚果，用户好评", products: ["每日坚果"] },
    ],
    episodeTimes: [5, 11],
  },
  {
    visitorId: "cu_sunqing",
    isNewUser: true,
    facts: [
      { kind: "preference", content: "喜欢奶香口味" },
      { kind: "budget", content: "学生党，预算20元以内" },
    ],
    episodes: [
      { question: "有奶香味的小饼干吗，20块以内", summary: "学生党咨询奶香饼干，推荐小圆饼干", products: ["奶香小圆饼"] },
    ],
    episodeTimes: [6],
  },
  {
    visitorId: "cu_zhouqiang",
    isNewUser: false,
    facts: [
      { kind: "preference", content: "喜欢巧克力，尤其黑巧" },
      { kind: "preference", content: "关注配料表，偏好高可可含量" },
      { kind: "budget", content: "巧克力预算约60元" },
      { kind: "identity", content: "老客，黑巧复购3次" },
    ],
    episodes: [
      { question: "黑巧还有货吗，老规矩来一盒", summary: "老客第3次复购黑巧克力", products: ["70%黑巧克力"] },
      { question: "有没有可可含量高点的巧克力，太甜的不要", summary: "首咨高可可巧克力，偏好明确", products: ["70%黑巧克力"] },
    ],
    episodeTimes: [3, 10],
  },
  {
    visitorId: "cu_linyi",
    isNewUser: true,
    facts: [
      { kind: "scenario", content: "办公室下午茶拼单场景" },
      { kind: "preference", content: "团队口味多元，偏爱混合装" },
    ],
    episodes: [
      { question: "我们部门下午茶拼单，来点混合口味的", summary: "部门拼单咨询，推荐混合装零食", products: ["什锦拼盘"] },
    ],
    episodeTimes: [1],
  },
];

async function main() {
  const seedIds = new Set(PROFILES.map((p) => p.visitorId));
  let n = 0;
  for (const p of PROFILES) {
    n += 1;
    const episodes = p.episodes.map((e, i) => ({
      runId: demoRunId(n * 10 + i),
      question: e.question,
      summary: e.summary,
      products: e.products ?? [],
      ts: daysAgo(p.episodeTimes[i] ?? 1, 10 + i * 3),
    }));
    const profile = {
      visitorId: p.visitorId,
      createdAt: episodes.length ? episodes[episodes.length - 1].ts : daysAgo(1),
      updatedAt: episodes.length ? episodes[0].ts : daysAgo(1),
      isNewUser: p.isNewUser,
      // 演示取值：老客比新客多一次历史交互；固定算法，保证重跑结果一致
      interactionCount: episodes.length + (p.isNewUser ? 0 : 1),
      facts: p.facts.map((f) => ({
        kind: f.kind,
        content: f.content,
        sourceRunId: episodes[0]?.runId,
        updatedAt: episodes[0]?.ts ?? daysAgo(1),
      })),
      episodes,
    };
    await atomicWriteText(
      path.join(profilesDir, `${p.visitorId}.json`),
      JSON.stringify(profile, null, 2) + "\n"
    );
  }
  console.log(`Seeded ${PROFILES.length} visitor profiles -> ${profilesDir}`);
  console.log(`只覆盖本脚本声明的演示画像（${[...seedIds].join("、")}），其他画像不受影响。`);
  console.log(
    `Summary: ${PROFILES.filter((p) => !p.isNewUser).length} 老客 / ${PROFILES.filter((p) => p.isNewUser).length} 新客，共 ${PROFILES.reduce((s, p) => s + p.facts.length, 0)} 条事实（合成数据）`
  );
}

void main();
