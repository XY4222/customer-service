# PRD：人工坐席代笔（A2 · 只填不发）

> 项目：`23-项目全链路智能客服平台`（SnackOps 零食电商客服 Agent 平台）
> 状态：待评审（本文档为设计源头；实现与验证完成前，`11/12/13` 课件不得声称该能力已实现）
> 撰写方式说明：课程规则要求本 PRD 经 `ai-product-prd` 技能核对。**该技能在本会话不可用**，本文按规则列出的检查清单逐项人工执行（目标/用户/范围/Agent 行为/Prompt/知识与数据/工具接口/权限/异常/评估与验收），并把矛盾与待确认项显式保留。**该门槛未由技能验证**，请评审时确认。

## 1. 背景与问题

现状（已核对代码，非推测）：

- `skills/human-handoff-decision` 判定需要转人工时，executor 只产出一句 `handoffMessage`（默认「已为您转接人工客服，请稍候。」）当作最终回复（`src/lib/executor.ts:383-385`、`:515-525`）。
- `POST /api/runs/[id]/handoff` 可把某次运行标记为「已转人工」，写入 `run.handoffToHuman / handoffReason / handoffAt`（`src/app/api/runs/[id]/handoff/route.ts`）。
- `/ops` 的「运行监控」展示人工接管率与「已转人工」标记；`/ops` 还有「人工评估」Tab。

缺口：**转人工之后没有任何人工介入界面**——没有候选话术、没有坐席工作台、没有「谁最终发了哪条」的留痕。学员能讲"该转人工"，但看不到"人怎么接手"。

## 2. 目标与非目标

目标：

1. 命中转人工时，系统为坐席起草 **3 条候选话术**（差异化策略，附适用场景与风险标注）。
2. 提供**坐席工作台**：查看待处理会话 → 点选候选 → 由坐席自行发送。
3. 全程**留痕可审计**：候选内容、选择人、选择时间、标记发送时间都写入运行记录。

非目标（本期不做）：

- 不做真实的消息发送通道（对客发送仍由坐席在既有渠道完成）——这正是「只填不发」的技术保证。
- 不做坐席账号体系与登录（见 §13 待确认）。
- 不做候选在线编辑后再发送（先点选，编辑留后续迭代）。
- 不做多坐席抢单/工单分派。

## 3. 用户与角色

| 角色 | 诉求 | 本期权限 |
| --- | --- | --- |
| 访客 | 得到有人味、不出错的答复 | 只读（看转人工提示） |
| 坐席（演示由教师/学员扮演） | 一眼看懂问题、快速选一条合适的、明确知道"还没发" | 生成候选、点选候选、标记已发送 |
| 运营 | 追溯「转人工后谁发了什么」 | 只读运行记录与留痕字段 |

## 4. 业务流程与状态机

```
访客提问 ──Planner──▶ human-handoff-decision 判定 needsHuman=true
        │
        ├─▶ 运行记录 handoffToHuman=true（已有）        —— 状态：待人工
        │
        └─▶ 坐席工作台 /handoff
               ├─ 点「生成候选」 ─▶ 3 条候选落库          —— 状态：候选已生成
               ├─ 点选一条        ─▶ selectedCandidateId   —— 状态：已选候选
               └─ 点「标记为已发送」─▶ sentAt              —— 状态：已发送（由坐席在外部渠道完成）
```

硬性规则：**系统在任何状态下都不会自动发出候选**；「已发送」只是坐席的人工声明，由后端记录时间，不触发任何外发动作。

## 5. Agent / AI 行为

- 新技能 `draft-candidates`：输入本次运行的 `question`、`finalReply`（接管话术）、`riskResult.issues`、`need-extraction` 的结构化输出、可用商品/活动摘要（由调用方传入，禁止编造价格）；输出严格 JSON：

```json
{ "candidates": [
  { "id": "c1", "style": "稳妥说明", "content": "…", "riskNote": "…", "riskLevel": "low" },
  { "id": "c2", "style": "共情安抚", "content": "…", "riskNote": "…", "riskLevel": "medium" },
  { "id": "c3", "style": "简短推进", "content": "…", "riskNote": "…", "riskLevel": "low" }
], "notes": "生成说明" }
```

- 三条候选必须**策略不同**（示例：稳妥说明 / 共情安抚 / 简短推进），且每条给出 `riskNote`（例如"涉及赔付，需人工确认权限"）。
- 价格与承诺红线沿用现有约束：候选不得编造价格、活动、优惠券，不得出现禁词与过度承诺（与 `skills/risk-check` 的口径一致）。
- 生成失败或 `classroom-fixture` 模式：用**规则模板兜底**（按转人工原因分支：投诉 / 退款退货 / 物流异常 / 过敏安全 / 其他），保证课堂无模型也能演示，且结果确定。

## 6. Prompt 要点（写进 `skills/draft-candidates/SKILL.md`）

1. 角色：电商客服组长的「代笔助手」，为人工坐席起草，**不直接对客**。
2. 必须理解并复述：用户诉求、已发生的处理（风控 issues）、不可承诺项。
3. 输出 3 条差异化候选 + 每条风险标注 + 一句生成说明。
4. 禁止：编造价格/活动/优惠券；出现「绝对/100%/包退/包赔/保证」等禁词；替公司做赔偿承诺；提及系统内部字段名。
5. 语气：像店里常客，不浮夸（与 `DESIGN.md` 文案口径一致）；每条 60–160 字。

## 7. 知识与数据

- 运行记录（`data/runs.json`）新增字段（写入走既有原子写）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `draftCandidates` | `DraftCandidate[]` | 3 条候选：`{id, style, content, riskNote, riskLevel}`（id 统一为 c1..cN） |
| `draftUsedFallback` | `boolean` | 候选是否来自规则模板兜底；UI 必须如实标注 |
| `selectedCandidateId` | `string \| null` | 坐席选中的候选 |
| `selectedBy` | `string \| null` | 选择人标识（演示期由前端填"坐席/坐席姓名"，非账号体系） |
| `selectedAt` / `sentAt` | ISO string \| null | 选择时间 / 坐席标记发送时间 |

- 已有字段复用：`handoffToHuman / handoffReason / handoffIssues / handoffAt`。
- 隐私：候选内容与输入文本在落库前复用 `redactPII`；**脱敏后仍带脱敏标记的候选整条丢弃**（触及敏感信息的候选不该发给用户）；不新增任何个人信息字段。

## 8. 工具与接口

| 接口 | 方法 | 用途 | 失败行为 |
| --- | --- | --- | --- |
| `/api/runs/[id]/draft-candidates` | POST | 生成（或重新生成）3 条候选并落库 | run 不存在→404；非转人工 run→400（`NOT_HANDOFF`）；LLM 失败→模板兜底并标记 `usedFallback` |
| `/api/runs/[id]/draft-candidates` | PATCH | `{action:"select", candidateId, operator}` 或 `{action:"mark-sent", operator}` | 未知 `candidateId`→400；未选择就 mark-sent→400（`NO_SELECTION`）；run 不存在→404 |

- **不存在任何发送接口**——这是「只填不发」的技术保证，评审时可 grep 验证。
- 复用 `GET /api/runs` 列表（已有 `handoffToHuman`/`handoffReason` 字段）驱动工作台列表。

## 9. 权限与边界

- 后端不提供发送能力，因此"系统自动发出"在架构上不可能；前端隐藏也不作为授权手段——即使有人直接调 PATCH，也只能改记录，发不出消息。
- 演示期不做登录：`operator` 由前端填写（默认「演示坐席」）。**这是本期已接受的简化，不是安全设计**（见 §13）。

## 10. 异常与失败

| 场景 | 期望行为 |
| --- | --- |
| 模型返回非法内容 / 超时 / 额度不足 | 保留真实失败结果：`usedFallback=true` + 模板候选，UI 明示"模板兜底"，不显示为模型生成 |
| 非转人工会话被点开 | 工作台不显示（或显示"该会话未被判定需要人工"），接口 400 |
| 坐席未选择 | 状态停留在「待人工/候选已生成」，**不得显示成功** |
| 候选落库失败 | 报错并保留上一次候选，不覆盖为空 |

## 11. 评估与验收

> 实施状态（2026-09-24）：硬性验收 1–5 已在实现过程中实测通过（确定性触发、候选生成、点选与标记发送留痕、错误码、禁词与隐私）。证据与命令见 `AGENTS.md`「人工坐席代笔」与 `scripts/test-handoff.ts`（`pnpm handoff:test`，22 项）。
>
> **第 6 项（留痕可见面）状态修正**：候选/选择/发送留痕当前可见于 **`/handoff` 坐席工作台**（面板内含「留痕」区块）；`/ops` 仍只显示「人工接管率」与「已转人工」标记，`/runs/[runId]` 轨迹页**尚未**渲染候选与选择。即：数据已持久化在 `runs.json`，但轨迹页与 `/ops` 的展示属于**后续项**，不计入本期通过范围。

硬性验收项（全过才算 PASS）：

1. 真实运行下，投诉类问题触发转人工（**已实现为确定性关键词触发**，不依赖模型自觉；真实模型规划到该步骤时使用模型给出的原因），工作台能生成 3 条**策略不同**的候选。
2. `fixture` 模式（无模型）下同样能生成 3 条候选，且两次运行结果一致（确定性）。
3. PATCH `select` 后 `selectedCandidateId/selectedBy/selectedAt` 落库；PATCH `mark-sent` 后 `sentAt` 落库，且**没有任何外发动作**（grep 无发送实现 + 接口清单无发送端点）。
4. 未选择就 `mark-sent` → 400；未知候选 id → 400；非转人工 run → 400；请求体非对象（`null`/数组/字符串）→ 400；run 不存在 → 404。
5. 候选文本不含编造价格/禁词（与 `risk-check` 同口径抽查）；不含手机号等敏感信息（触及即整条丢弃）。
6. 留痕可见面：**`/handoff` 面板内的留痕区块**（本期通过范围）；`/ops` 与 `/runs/[runId]` 的展示列为后续项（见上方状态修正）。

质量项（缺失记 PARTIAL）：候选话术可读性与差异化程度；`riskNote` 是否真的指出了风险点。

回归方式（**已修正原计划**）：原定"新增 2 条 Eval 用例"不可行——Eval 框架只校验**回复关键词**，无法表达"坐席动作"这类行为。改为：
- `pnpm handoff:test`：进程内 fixture 回归（确定性转人工、回复不被接管话术覆盖、候选确定性与脱敏、四种场景分支）；
- API 级实测：`POST/PATCH /api/runs/[id]/draft-candidates` 的成功与四类错误码；
- 浏览器实测：`/handoff` 生成 → 点选 → 标记发送 → 留痕与列表徽章同步。

## 12. 与课件的关系

- 该能力落地后，`11-DAY3下午 / 12-DAY4上午 / 13-DAY4下午` 的「完整实操」环节可增加一个人机协同闭环：**AI 起草 → 人决定 → 留痕**，与 `skill_risk`（能不能发）形成"谁来决定发不发"的产品判断对照。
- 实现与真实运行验证完成前，课件、设计卡、学员手册不得声称该能力存在（课程规则：不得编造已实现功能）。
- 完成后需同步：`00-课程设计卡.md`、PPT、逐字稿、学员手册、验收标准、`05-项目支撑审计.md`。

## 13. 待确认（需用户裁定，本 PRD 显式保留）

1. ~~**fixture 下的演示路径**~~ **已决：采用确定性规则**——新增 `src/lib/handoff-rules.ts`，执行器命中信号词即标记待人工（不改计划、不覆盖回复）。演示时无模型也能复现；工作台底部仍保留"把任意会话标记为待人工"的手动入口。
2. **是否引入坐席角色/登录**：本期用 `operator` 文本字段替代（默认「演示坐席」），**不是安全设计**；真实权限需要账号体系与后端校验。
3. **候选是否允许坐席编辑后再发送**（本期先不做，现为点选即用）。
4. **是否需要记录"未采用原因"**（用于评测候选质量）。

## 14. 实现落点（供评审对照代码）

| 落点 | 文件 |
| --- | --- |
| 技能 Prompt | `skills/draft-candidates/SKILL.md` |
| 候选生成/归一化/兜底/脱敏 | `src/lib/draft-candidates.ts` |
| 转人工确定性信号 | `src/lib/handoff-rules.ts`（被 `executor.ts`、`llm.ts` fixture 共用） |
| 标记与原因留痕 | `src/lib/executor.ts`（`handoffToHuman/handoffReason/handoffMessage`） |
| 运行记录字段 | `src/lib/store.ts`（`draftCandidates/draftUsedFallback/selectedCandidateId/selectedBy/selectedAt/sentAt`） |
| 接口 | `src/app/api/runs/[id]/draft-candidates/route.ts` |
| 坐席工作台 | `src/app/handoff/page.tsx` + `src/components/app-nav.tsx` |
| 回归脚本 | `scripts/test-handoff.ts`（`pnpm handoff:test`） |
