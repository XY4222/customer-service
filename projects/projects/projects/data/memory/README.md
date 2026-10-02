# data/memory —— 长期记忆（访客画像）数据说明

供课前准备、课堂演示与运营查看时核对数据来源，避免把演示数据当成真实用户数据。

## 目录结构

- `profiles/<visitorId>.json`：一个访客一份画像，写入走原子写（`src/lib/fs-atomic.ts`），并发写互不影响。

## 画像字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `visitorId` | string | 访客标识，白名单 `[A-Za-z0-9_-]{1,64}`（前端生成 `cu_` 前缀） |
| `createdAt` / `updatedAt` | ISO string | 首次/最近更新时间 |
| `isNewUser` | boolean | 新客=true；检测到购买/复购后翻转为 false（售后/查单语境不翻转） |
| `interactionCount` | number | 记忆化交互次数 |
| `facts[]` | array | 稳定事实，`kind` ∈ preference/restriction/identity/budget/scenario/other；同类≤8 条、总量≤30 条 |
| `episodes[]` | array | 交互轨迹摘要，≤20 条、新的在前；`question` / `summary` 写入前已脱敏 |

## 数据来源类别

按课程数据规范的三类口径（脱敏真实 / 合成 / Mock）标注：

- **合成数据（课堂演示）**：由 `scripts/seed-memory.ts` 生成的 8 个演示画像
  （`cu_wangmeili`、`cu_lihao`、`cu_zhangwei`、`cu_chenxi`、`cu_zhaomin`、`cu_sunqing`、`cu_zhouqiang`、`cu_linyi`）。
  非真实用户，不含真实个人信息。生成日期：2026-09-24；数据时间范围：相对脚本运行时刻的前 16 天内（每次 seed 会刷新为「最近」）。
- **运行产物（视同合成）**：课堂/演示期间用合成提问真实运行后，由 `src/lib/memory.ts` 的 `updateMemoryAfterRun`
  提取生成。输入是课堂演练用的合成内容，不是真实用户数据，
  也不属于生产数据。时间范围：运行时点（如 2026-09-19）。
- **脱敏真实**：本目录目前**没有**此类数据。
- **脱敏红线**：手机号、座机、证件号、13–19 位长数字串、含省市路号的地址、楼栋门牌在写入画像
  和送入模型前统一替换为脱敏标记；带脱敏标记的文本不会成为「稳定事实」。实现见 `redactPII`。

## 生成 / 再生成

- 生成演示画像：`pnpm memory:seed`（**只覆盖上面 8 个演示 visitorId，不会删除其他画像**）。
- 自检（含脱敏、身份翻转、seed 幂等、不误删真实画像、展示层映射）：`pnpm memory:test`。

## 对应项目与课次

- 项目：`23-项目全链路智能客服平台`（SnackOps 零食电商客服 Agent 平台）
- 课次：`11-DAY3下午`、`12-DAY4上午`、`13-DAY4下午`
- 对应项目版本：交付时的工作区版本（GitHub 仓库提交与备用 ZIP 版本号以项目根的 `00-课前环境准备.md` 记录为准）

## 指标口径

- `interactionCount`：完成并成功提取记忆的交互次数（每次 `source=user|demo` 的运行 +1）。
- `facts[]`：去重后的稳定事实条数，同类≤8 条、总量≤30 条（满额淘汰同类最旧一条）。
- `episodes[]`：保留最近 20 条交互摘要，新的在前。

## 已知限制

- 演示画像的 `interactionCount` 是演示取值（`episodes 数 + 老客补偿 1`），不是真实统计口径。
- 演示画像的时间戳相对脚本运行时刻生成，重跑会刷新为「最近」，因此每次运行的时间字段不同。
- 画像仅服务演示与运营查看；`runs.json` 仍保存原始会话文本，不在本目录的脱敏范围内。
