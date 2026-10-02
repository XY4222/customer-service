# AGENTS.md

## 项目概览
**零食电商客服 Plan + Skill 可配置执行平台 (SnackOps)**

一个可演示、可运营的客服 Agent 编排平台。用户前台提问 → Planner 生成执行计划 → Executor 逐步执行（SSE 流式推送每一步 I/O）→ 风控审核后返回最终回复。
后台提供 Skills/Tools 管理、会话审计、Eval 批量回归评测等运营能力。

## 核心目录
```
data/                       # 本地 JSON 数据库
  products.json             # 25 个零食商品
  activities.json           # 12 个活动（满减/折扣/新客/品类）
  coupons.json              # 12 张优惠券（无门槛/满减/品类券）
  orders.json / return-policies.json / logistics.json / faq.json / users.json / tickets.json
                            # 售后侧 Tool 数据源：订单、退换货政策、物流、FAQ、用户画像、工单
  runs.json                 # 运行会话记录（自动持久化）
  eval_cases.json           # Eval 黄金用例集（12 条）
  eval_batches.json         # Eval 批次记录
  memory/                   # 长期记忆画像（字段与来源见 data/memory/README.md）
  skills.json / tools.json  # ⚠️ 历史遗留文件：运行时**不再读取**，勿照着改（技能看 skills/<id>/SKILL.md，工具启停看 tools-config.json）
skills/                     # 技能事实源：每个技能一个目录，prompt 与参数在 SKILL.md 的 frontmatter + 正文
src/
  lib/
    llm.ts                  # LLM 客户端：callLLM(opts, request?)（内部按 provider 分发，无独立 chat/chatStream）
    store.ts                # JSON 持久层：商品/活动/券/Runs/Eval/Tool 启停 读写
    tools.ts                # 4 个基础 Tool 实现 + TOOLS 元数据（name/description/parameters）
    tools-ex.ts             # 9 个售后/知识/写入类 Tool 实现（订单、物流、FAQ、工单、库存、地址…）
    planner.ts              # Planner：Prompt 组装 + 能力校验 + 9 步 fallback 计划（fixture 模式直接用兜底计划）
    executor.ts             # Executor：按 plan 顺序执行 Skill/Tool，解析 {{step_N.xxx}} 变量
    memory.ts               # 长期记忆库：访客画像读写 + LLM 提取 + 规则兜底 + 召回上下文构建 + PII 脱敏
    memory-view.ts          # 画像 → 面板数据的展示层映射（客户端安全，两种字段形状归一）
    visitor-id.ts           # 客户端访客标识（localStorage，前台两个入口共用）
    handoff-rules.ts        # 转人工确定性信号表（executor 与 llm.ts 的 fixture 分支共用）
    draft-candidates.ts     # 坐席代笔：候选生成（LLM + 模板兜底）+ 归一化 + 脱敏
  hooks/
    use-visitor-memory.ts   # 前台记忆数据源：visitorId + 已有画像 + SSE memory_recalled
  components/
    agent-console.tsx       # 前台：输入区 + 计划表 + 步骤轨迹 + 风控 + 最终回复（支持 replay 参数）
    skill-editor.tsx        # Skill 侧滑编辑器（基本信息/Prompt/模型参数/测试）
    memory-panel.tsx        # 「AI 记住了你」面板（前台 Agent 执行页 + Demo 聊天页共用）
  app/
    page.tsx                # 前台 Agent 执行页（输入区 + 计划 + 轨迹 + 风控 + 最终回复）
    demo/page.tsx           # 聊天 Demo 页（访客视角，含「AI 记住了你」面板）
    skills/page.tsx         # Skill 管理：列表 + 编辑器 + 单技能测试
    tools/page.tsx          # Tool 管理：参数 schema + 单 Tool 测试 + 启停开关
    planner/page.tsx        # Planner 管理：提示词/兜底计划预览
    models/page.tsx         # 模型管理：Provider 切换 + 测试连接
    ops/page.tsx            # 运营中心：运行监控 / 评分 / 评测集 / Eval / 标注 / 改进建议 / 人工评估 / 版本回滚 / Prompt A/B
    catalog/page.tsx        # 数据中心：商品/活动/券/订单等数据查看
    memory/page.tsx         # 记忆管理：访客画像列表 + 删除（被遗忘权）
    handoff/page.tsx        # 坐席工作台：待人工会话 + 3 条候选 + 点选 + 标记发送 + 留痕（只填不发）
    runs/[runId]/page.tsx   # 单次运行轨迹详情（step-by-step I/O + 复跑）
    api/
      agent/run/route.ts    # POST 启动 Agent，SSE 流式返回；source=user|demo|eval|replay；visitorId + 长期记忆召回/提取
      run/retry/route.ts    # POST 从某一步复跑（SSE）
      planner/route.ts / planner/preview/route.ts   # Planner 配置读写 / 计划预览
      skills/route.ts, skills/[id]/route.ts, skills/[id]/test/route.ts, skills/[id]/versions*/route.ts
                            # 技能列表/新建、详情/更新、单技能流式测试、版本历史与回滚
      tools/route.ts, tools/[id]/test/route.ts      # Tool 元数据与启停、单 Tool 执行
      runs/route.ts, runs/[id]/route.ts, runs/[id]/annotate/route.ts, runs/[id]/handoff/route.ts, runs/[id]/draft-candidates/route.ts
                            # 运行列表/详情、Bad Case 标注、标记「已转人工」、坐席代笔候选（生成/点选/标记发送）
      memory/route.ts, memory/[id]/route.ts         # 访客画像列表、详情/删除
      eval/route.ts, eval/batch/run/route.ts, eval/batch/[id]/route.ts, eval/cases/route.ts, eval/cases/[id]/route.ts
                            # 评测用例与批次：启动回归、轮询进度、启停用例
      annotations/route.ts, annotations/[id]/route.ts, annotations/export/route.ts
                            # 标注集合与导出
      ab-tests/route.ts, ab-tests/simulate/route.ts # Prompt A/B 实验与模拟
      ratings/route.ts, improvements/*, llm-config/*, catalog/route.ts, explain/route.ts, runtime/route.ts
                            # 评分、改进建议应用/生成、模型配置与测试、数据目录、解释、运行时状态
scripts/
  audit-capabilities.ts     # 能力对账（pnpm audit:capabilities）：计划引用的能力是否都注册且启用
  test-handoff.ts           # 坐席代笔回归自检（pnpm handoff:test）
  seed-memory.ts            # 生成长期记忆演示画像（合成数据，只覆盖脚本声明的 8 个 id）
  test-memory.ts            # 长期记忆回归自检（pnpm memory:test）
  seed-mock.ts              # 生成 runs.json / ratings.json 演示数据
  classroom-reset.mjs       # 课堂重置（恢复标准技能与数据）
```

## 内置 Skills（15 个，源文件 `skills/<id>/SKILL.md`；14 启用 + 1 停用草案）
| id | 名称 | 作用 |
|---|---|---|
| `need-extraction` | 用户需求结构化 | 输出 JSON（intent/categories/flavorTags/budget/scenario/isNewUser/…） |
| `recommendation-decision` | 商品推荐决策 | 基于已筛商品+需求选 1~3 个，返回 productId+理由 |
| `recommendation-reason` | 推荐理由生成 | 每件商品卖点文案 |
| `response-generator` | 客服话术生成 | 最终回复（强制使用 price.finalPrice，不许编造） |
| `risk-check` | 风控审核 | 合规检查（禁词/承诺/价格/新人判断）→ passed + issues（**最后一步必须是它**） |
| `after-sales-classification` | 售后问题分类 | 判别退货/换货/补发/投诉等售后类型 |
| `allergy-risk-reminder` | 过敏风险提醒 | 命中过敏原时生成提示（放在 response-generator 之前） |
| `clarification-question` | 澄清问题生成 | 需求模糊时生成追问 |
| `complaint-triage` | 投诉分流 | 投诉分级与处置建议 |
| `conversation-summary` | 会话总结 | 多轮会话摘要 |
| `gift-scenario-advisor` | 送礼场景推荐 | 送礼场景的选品建议 |
| `human-handoff-decision` | 人工接管判断 | 判断是否转人工 → needsHuman + handoffMessage（A2 坐席代笔的前置） |
| `product-substitution` | 缺货替代推荐 | 缺货时推荐替代品 |
| `draft-candidates` | 坐席代笔候选 | 转人工后为坐席起草 3 条差异化候选话术（只填不发，见「人工坐席代笔」） |
| `对话问候-skill` | 对话问候 Skill | **停用**：课堂 AI 新建 Skill 的草案示例，不会被 Planner 引用 |

## 内置 Tools（13 个：4 个在 `tools.ts`，9 个在 `tools-ex.ts`）
| id | 名称 | 功能 | 启停 |
|---|---|---|---|
| `query_products` | 查询商品 | keyword/category/flavor/tags/budget/scenario 多维过滤 | 启用 |
| `query_activities` | 查询活动 | 按场景（newUser/category/threshold）过滤 | 启用 |
| `query_coupons` | 查询优惠券 | 按门槛/有效期/适用品类/自动选最优 | 启用 |
| `calculate_price` | 计算价格 | 满减 → 品类折扣 → 新客立减 → 优惠券 → finalPrice | 启用 |
| `query_order` | 查询订单 | 按订单号/手机号查订单状态、明细、支付金额 | 启用 |
| `query_return_policy` | 退换货政策 | 按品类/场景查售后政策 | 启用 |
| `track_logistics` | 查询物流轨迹 | 承运商、当前状态、轨迹、预计送达 | 启用 |
| `search_faq` | 知识库搜索 | 搜索 FAQ 知识库返回标准答案 | 启用 |
| `query_user_profile` | 查询用户画像 | 用户等级、累计消费、历史标签、过敏信息 | 启用 |
| `estimate_delivery` | 预估配送时效 | 按地址/品类/时间估送达，返回推荐发货仓 | 启用 |
| `create_after_sales_ticket` | 创建售后工单 | 创建退货/换货/补发/投诉工单（**写入类**） | 启用 |
| `reserve_stock` | 锁定库存 | 下单前锁定库存 15 分钟（**写入类**） | **停用**（默认关闭，需在 `/tools` 页显式开启） |
| `parse_address` | 解析收货地址 | 自然语言地址 → 省/市/区/详细地址/联系人/手机号 | 启用 |

> 工具启停由 `data/tools-config.json` 控制，读取时与 `store.ts` 的 `DEFAULT_TOOLS` **合并**（文件里没登记的工具用默认启停，所以"文件里没有"≠"未启用"）；`/tools` 页面可切换。

## 关键约束
- **Planner** plan 只能引用 `skills/<id>/SKILL.md`（技能）与 `tools-config.json` 中启用（工具）的能力。**未注册或未启用的 ref 会被静默丢弃**（执行轨迹里表现为 `skipped`），所以改完技能 / 工具 / Planner 提示词后必须跑 `pnpm audit:capabilities` 对账。
- **价格/活动/优惠券** 禁止 LLM 生成，必须 Tool 获取并经 `calculate_price` 计算。
- **最后一步必须 `risk-check`**，通过后 finalReply 才渲染。
- **Eval 评测**：expectedKeywords 支持 `A|B|C` 同义词组（组内任一命中即通过），expectedPrice > 0 时校验回复中出现的第一笔金额。
- **source 字段**：`user`（前台 Agent 执行页）/ `demo`（聊天 Demo 页）/ `eval`（评测批次）/ `replay`（后台复跑），用于区分运行来源；长期记忆只对 `user` 与 `demo` 提取（见「长期记忆系统」）。
- **自动降级**：当 `data/llm-config.json` 记录的 activeProvider 所需的密钥/SDK 环境变量缺失时（例如部署后选了 openai-compatible 但没配 OPENAI_API_KEY），`getRuntimeFallbackInfo()` 会自动降级到 `classroom-fixture`（演示稳定模式），并在所有页面顶部的黄色 RuntimeBanner 中显示原因与「去模型管理配置」按钮；`GET /api/runtime` 会返回 `fallback.degraded=true`、`fallback.reason` 等字段，供前端判断。降级发生时不会把 data 文件改掉，用户配好密钥后下次刷新即自动恢复。

## 长期记忆系统（2026-09 新增）
- **定位**：跨会话用户画像记忆——访客关闭浏览器再次访问后，AI 仍记得口味偏好/忌口/预算/身份（新客/老客）。
- **用户标识**：前端 `localStorage` 持久化 `snackops_visitor_id`（`cu_` 前缀，见 `src/lib/visitor-id.ts`，Agent 执行页与 Demo 聊天页共用同一份画像），随 `POST /api/agent/run` 的 `visitorId` 字段上传。
- **id 白名单**：`sanitizeVisitorId` 只接受 `[A-Za-z0-9_-]{1,64}`，并显式排除 Windows 保留设备名（con/nul/com1/lpt1…，否则会写到设备而不是文件、记忆静默丢失）；非法 id 一律按「无记忆访客」处理，`profilePath` 返回 null，`writeProfile` 直接抛错。
- **存储**：`data/memory/profiles/<visitorId>.json`，一人一文件（天然并发隔离），原子写。画像 = `facts[]`（稳定事实，kind: preference/restriction/identity/budget/scenario/other，kind 走白名单校验、去重、同类≤8 条【满额淘汰该类最旧一条】、总量≤30 条）+ `episodes[]`（交互轨迹摘要，≤20 条新的在前）+ `isNewUser`（检测到购买/复购后翻转为 false）。
- **读取容错**：`normalizeProfile` 给外部编辑过的画像文件补齐字段（facts/episodes/interactionCount…），避免 `/memory` 页与召回链路因缺字段 500。
- **链路**：
  1. **召回**：run 路由 start 时 `readProfile` → `buildMemoryContext` 压缩成上下文块 → SSE 推 `memory_recalled` 事件（前端记忆面板展示）→ 注入 `generatePlan`（Planner prompt「用户长期记忆」段）+ executor `globals.memory`，且 `need-extraction` / `response-generator` 两个关键 skill 的 input 自动追加 `memory` 字段。
  2. **提取**：`saveRun` 后异步 `updateMemoryAfterRun`（不阻塞 SSE）。**source=user|demo 才提取**（user=Agent 控制台，demo=聊天 Demo 页，同一个真实访客）；eval / replay 不写记忆，避免评测与复跑污染画像。LLM 提取（jsonMode）失败或 fixture 模式时用 `ruleBasedExtract` 规则兜底（口味词/预算正则/购买意图），保证课堂演示可用。
- **新客身份翻转**：`shouldFlipToOldUser` 统一判定——明确复购表述（复购/回购/再买/又买/续购/再囤/又来）直接翻转；售后/查单语境（订单号/物流/退货/退款/售后…）不算购买证据；只表达购买意向（想囤点/想买/囤货）同样不算；其余交给提取器。避免一句「订单号是多少」或「想囤点零食」就把新客变成老客。
- **隐私红线**：写入画像与送入模型前统一走 `redactPII`（手机号/座机/证件号/13–19 位长数字串/含省市路号的地址/楼栋门牌 → 脱敏标记），带脱敏标记的文本不再成为「稳定事实」。**注意：`runs.json` 仍保存原始会话文本，不在本次脱敏范围内。**
- **占位符说明**：executor 支持 `{{memory}}`（`globals.memory`），但内置 skill 的 input 里默认**没有**引用该占位符；关键 skill 由 executor 自动追加 `memory` 字段，学员也可在 `/skills` 页面自行在 input 中写 `{{memory}}` 观察注入效果。
- **前端**：对话区上方"AI 记住了你"面板（`src/components/memory-panel.tsx`，Brain 图标 + 事实标签 + 上次交互摘要），前台 Agent 执行页与 Demo 聊天页都显示；两个入口共用 `src/hooks/use-visitor-memory.ts`（同一 visitorId、同一份画像，画像字段 `episodes` 与 SSE 的 `recentEpisodes` 由 `src/lib/memory-view.ts` 归一）；运营端 `/memory` 页（导航"运营"分组）可视化所有画像、支持删除（被遗忘权）。
- **API**：`GET /api/memory`（列表）、`GET/DELETE /api/memory/[id]`（详情/删除）。
- **数据来源与自检**：`data/memory/README.md` 记录画像字段、来源类别（合成演示 / 运行产物）与限制；`pnpm memory:seed` 生成演示画像（只覆盖脚本声明的 8 个 id，不动真实画像），`pnpm memory:test` 跑回归自检（脱敏、身份翻转、seed 幂等、不误删真实画像）。
- **红线**：记忆文件与 runs.json 一样走原子写；提取失败静默（记忆是增强不是关键路径）。

## 人工坐席代笔（A2 · 只填不发，2026-09 新增）
本节记录该能力的当前实现约束、状态机、接口和验收口径。
- **定位**：转人工之后，为坐席起草 3 条**差异化**候选话术，由坐席点选后自行在外部渠道发送。**系统没有任何发送端点**——这是「只填不发」的技术保证。
- **确定性转人工**：`src/lib/handoff-rules.ts` 的信号表（投诉/赔偿/异物/食品安全/转人工…）在 `executor.ts` 命中即标记 `handoffToHuman=true` 并给出原因；**不依赖模型自觉规划** `human-handoff-decision`。标记不改计划、也不覆盖 AI 已生成的回复（只在没有对外回复时才用接管话术），因此 Eval 口径不变。模型自己规划了该步骤时（真实模型常见），使用模型给出的原因与接管话术。
- **候选生成**：`src/lib/draft-candidates.ts` —— 优先用 `skills/draft-candidates/SKILL.md` 调用 LLM（jsonMode），返回非法内容或 fixture 模式下用**规则模板兜底**（按投诉/退款/物流/过敏/其他分支，确定性）；候选落库前复用 `redactPII`，**脱敏后仍带脱敏标记的候选整条丢弃**（内容触及手机号等敏感信息就不该发给用户），候选 id 统一重排为 c1..cN 保证唯一。
- **状态机**：待人工（`handoffToHuman`）→ 候选已生成（`draftCandidates`）→ 已选候选（`selectedCandidateId/selectedBy/selectedAt`）→ **坐席已发送**（`sentAt`，由坐席点击标记）。UI 徽章与留痕统一用「坐席已发送」措辞，避免读成系统发送。重新生成候选、改选另一条、或复跑该会话都会清空选择与发送留痕，保证留痕与当前候选一致。
- **接口**：`POST /api/runs/[id]/draft-candidates`（生成）、`PATCH`（`select` / `mark-sent`）；run 不存在→404、非转人工→400 `NOT_HANDOFF`、未知候选→400、未选择就标记发送→400 `NO_SELECTION`。
- **页面**：`/handoff` 坐席工作台（导航「运营」分组）：待人工列表 + 候选卡片 + 点选 + 标记发送 + 留痕；底部「最近会话」可把任意会话标记为待人工（fixture 无模型时的演示入口）。
- **自检**：`pnpm handoff:test`（确定性触发、回复不被覆盖、候选确定性与脱敏、场景分支）。
- **未决**：是否引入坐席账号体系、候选是否可编辑后再发送、是否记录未采用原因。

## 持久化写入规范（必须遵守）
- **所有 data/*.json 与 skills/<id>/SKILL.md 的写入必须走原子写**：`src/lib/fs-atomic.ts` 的 `atomicWriteTextSync` / `atomicWriteText`（temp 文件 + `fs.rename`），禁止直接 `fs.writeFile`。
  - 历史教训：多个 API 并发写同一 JSON 文件（如 skill-versions.json）时，非原子写会交错产生两份 JSON 拼接的损坏文件（`JSON.parse` 报 "Extra data"），且 rollbackSkillVersion 等读到坏文件直接 500。
  - 已改造的写入点：skill-versions.ts、ab-tests/route.ts、ab-tests/simulate/route.ts、planner.ts、llm.ts、tools-ex.ts、skills-registry.ts、store.ts（3 处）、ratings/route.ts、memory.ts（画像）、scripts/seed-memory.ts；store.ts 的 writeJsonFile 本就是原子模式。
  - **已知遗留（尚未统一到 fs-atomic 的离线脚本）**：`scripts/seed-mock.ts`（runs.json / ratings.json / annotations.json）、`scripts/seed-skill-versions.ts`（skill-versions.json）、`scripts/classroom-reset.mjs`（各自实现 temp+rename）。三者均为单进程离线执行、无并发写，故未触发过损坏。
  - **新增任何持久化写入点时，一律 import fs-atomic**。
- **读取无内存缓存**：store/registry 每次请求直接读磁盘文件，磁盘数据被外部修改（如 git checkout 恢复）后立即生效，无需重启服务。
- **SSE 流式路由的步骤状态回写模式**（见 run/retry/route.ts）：degraded 状态在 onStepComplete 之后才能确定，需通过 `executePlan` 的 `onStepRecord` 回调回写 `newSteps`，不要在回调里引用尚未赋值的变量（TDZ）。

## LLM 模型
- 统一通过 `src/lib/llm.ts` 的 `callLLM(opts, request?)` 调用（内部按 provider 分发；不存在独立的 `chat()` / `chatStream()`）
- Provider 三选一：
  - `classroom-fixture`：课堂演示稳定模式，无需外部凭据
  - `openai-compatible`：OpenAI 兼容接口，需配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL`
  - `classroom-fixture`：演示稳定模式，无需任何外部凭证，返回确定性输出（覆盖核心 Eval 用例）
- **数据文件驱动**：`data/llm-config.json` 的 `activeProvider` / `defaultModel` 是"模型管理页"控制的来源
  - 启动时 `src/server.ts:bootstrap()` 调 `loadAndApplyConfigFromDisk()`，把 data 文件值同步到 `process.env.LLM_PROVIDER` / `LLM_MODEL` + `_runtimeProviderOverride` / `_runtimeModelOverride`（**data 文件总是生效，会覆写 .env.local**）
  - 这解决了 Next.js dev 模式 worker 进程模块图隔离的问题（worker 与主进程共享 process.env）
  - 页面 `PUT /api/llm-config` / `POST /api/llm-config/switch` 修改后立即 apply，无需重启
  - **安全红线**：data 文件**绝不存明文 API Key**；后端 PUT 拒绝任何 `apiKey` / `secret` / `token` / `authorization` 命名字段
- 后台管理页：`/models`（`src/app/models/page.tsx`），导航在 `src/components/app-nav.tsx` 的"配置"分组
- 运行时当前 Provider/模式通过 `GET /api/runtime` 暴露，前台会显示对应徽标
- 温度/MaxTokens 在每个 Skill 配置中独立设置
- Provider 缺失必需配置时调用会返回中文错误信息，并在错误事件中透出，不会被误记为普通质量 FAIL
- **模型名兼容层**：`src/lib/llm.ts:pickModelForProvider` 会把当前服务不支持的 Skill 模型名映射到运行环境指定的 `LLM_MODEL`，避免把服务商专属模型名写死在课程流程中
- **当前实际跑的 LLM 链路**（共 8 个 call site）：
  - `src/lib/planner.ts:190` — 计划生成（**classroom-fixture 模式下不调用**，直接用 `fallbackPlan()`）
  - `src/lib/executor.ts:163` — 单步执行（每个 skill 一次）
  - `src/lib/skills-registry.ts:168` — AI 新建 Skill
  - `src/lib/memory.ts:425` — 长期记忆提取（jsonMode）
  - `src/lib/draft-candidates.ts:158` — 坐席代笔候选生成（jsonMode）
  - `src/app/api/skills/[id]/test/route.ts:53` — Skills 页面"测试"按钮
  - `src/app/api/improvements/generate-prompt/route.ts:197` — 运营中心"生成 Prompt 建议"
  - `src/app/api/llm-config/test/route.ts:38` — 模型管理"测试连接"

## 开发命令
- 启动：`pnpm dev`（HMR，端口 5000）
- 构建：`pnpm build`
- 启动生产：`pnpm start`
- 静态检查：`pnpm lint` / `pnpm ts-check`
- 能力对账：`pnpm audit:capabilities`（计划引用的技能/工具是否都注册且启用；改技能或提示词后必跑）
- 坐席代笔自检：`pnpm handoff:test`（确定性转人工、候选确定性与脱敏、场景分支）
- 记忆库自检：`pnpm memory:test`（脱敏、身份翻转、seed 幂等、不误删真实画像）
- 生成记忆演示数据：`pnpm memory:seed`

## 常见修改点
- **新增 Skill**：在 `skills/<新id>/SKILL.md` 写 frontmatter（id/name/model/temperature/maxTokens/enabled/requiredTools）+ 正文 Prompt，或在 `/skills` 页面新建；随后把新技能加进 `planner.ts` 的 `fallbackPlan()`（按需）并跑 `pnpm audit:capabilities`。**不要改 `data/skills.json`（历史遗留，运行时已不读）。**
- **新增 Tool**：三处都要改——① 在 `src/lib/tools.ts` 的 `TOOLS` 注册元数据（name/description/parameters/category，**全部 13 个工具的元数据都在这里**）；② 在 `src/lib/tools.ts` 的 `runTool()` 加 `case "<id>"` 分发分支，实现函数放在 `src/lib/tools-ex.ts`（该文件只放实现，不放元数据）；③ 在 `src/lib/store.ts` 的 `DEFAULT_TOOLS` 登记元信息（默认启停、数据源文件）。启停由 `/tools` 页写入 `data/tools-config.json`。
- **改活动/商品/券**：直接编辑 `data/*.json`。
- **Plan 编排策略**：`planner.ts` 的 `DEFAULT_PLANNER_CONFIG.systemPrompt` 控制 LLM 决策空间（可被 `data/planner-config.json` 覆盖），`fallbackPlan()` 是兜底与 fixture 模式的实际计划源。
- **风控规则**：`skills/risk-check/SKILL.md` 的正文 Prompt；`/api/skills/[id]/test` 路由中自动注入 price 数据。
- **Eval 用例**：`data/eval_cases.json` 添加/编辑，或在 `/ops` 的「评测集 / Eval」Tab 启停与一键回归；关键词支持 `|` 同义词分隔。
- **会话标注**：`/ops` 的「标注」Tab 可标 Bad Case 加 note（写入 `runs.json`），单次运行轨迹在 `/runs/[runId]` 查看与复跑。
- **转人工**：`POST /api/runs/[id]/handoff` 把某次运行标记为「已转人工」（写入 `run.handoffToHuman/handoffReason/handoffAt`）；`/ops` 运行监控里有「人工接管率」与「已转人工」标记。技能侧的判定由 `skills/human-handoff-decision` 负责。

## 项目初始化与平台配置

### 项目识别
- **项目类型**：Web（Next.js 16 全栈 HTTP 服务）
- **部署类型**：service / web
- **运行时**：nodejs-24
- **服务端口**：5000

### 预览和部署配置
- **判定依据**：项目核心结果是浏览器可访问的 Web 界面（前台 Agent 执行页 + 后台运营管理页），属于 Web 预览型项目
- **预览入口**：自定义 Next.js 服务器 `src/server.ts`，通过 `pnpm tsx watch` 启动，支持 HMR
- **本地入口**：`pnpm dev`，访问 `http://localhost:5000`

### 部署配置
- **部署脚本**：
  - `scripts/build.sh`：安装依赖 → `next build` → `tsup` 打包 `src/server.ts` 为 `dist/server.js`
  - `scripts/start.sh`：`node dist/server.js`，端口由 `DEPLOY_RUN_PORT` 或默认 `5000` 控制
- **脚本工作目录**：所有脚本均基于 `SCRIPT_DIR` 推导 `PROJECT_DIR`，不依赖调用时的 `pwd`
- **部署入口**：`scripts/build.sh` 和 `scripts/start.sh`

### 注意事项
- 自定义服务器 `src/server.ts` 通过 `HOSTNAME` 和 `PORT` 环境变量控制绑定地址和端口
- 生产构建产物为 `dist/server.js`（由 tsup 打包），部署时直接 `node dist/server.js`
- LLM Provider 通过 `LLM_PROVIDER` 环境变量切换；课程基线使用 `classroom-fixture`，真实模型需要单独配置服务端环境变量

### 部署环境变量（生产）
- `LLM_PROVIDER`：`openai-compatible` / `classroom-fixture` / 其他已实现 Provider
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL`：当 `LLM_PROVIDER=openai-compatible` 时必填
- 真实模型的地址、密钥和模型名只放在运行环境变量中，不写入仓库或课程材料
