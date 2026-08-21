# AGENTS.md

## 项目概览
**零食电商客服 Plan + Skill 可配置执行平台 (SnackOps)**

一个可演示、可运营的客服 Agent 编排平台。用户前台提问 → Planner 生成执行计划 → Executor 逐步执行（SSE 流式推送每一步 I/O）→ 风控审核后返回最终回复。
后台提供 Skills/Tools 管理、会话审计、Eval 批量回归评测等运营能力。

## 核心目录
```
data/                       # 本地 JSON 数据库
  products.json             # 10 个零食商品
  activities.json           # 5 个活动（满减/折扣/新客/品类）
  coupons.json              # 3 张优惠券（无门槛/满减/品类券）
  skills.json               # 5 个 Skill（可后台增删改启停）
  runs.json                 # 运行会话记录（自动持久化）
  eval_cases.json           # Eval 黄金用例集（10 条）
  eval_batches.json         # Eval 批次记录
src/
  lib/
    llm.ts                  # LLM 客户端（doubao-seed）：chat() / chatStream()
    store.ts                # JSON 持久层：商品/活动/券/Skills/Runs/Eval 读写
    tools.ts                # 4 个 Tool 实现 + TOOLS 元数据（name/description/parameters）
    planner.ts              # Planner：Prompt 组装 + LLM 解析 + 9 步 fallback 计划
    executor.ts             # Executor：按 plan 顺序执行 Skill/Tool，解析 {{step_N.xxx}} 变量
  components/
    agent-console.tsx       # 前台：输入区 + 计划表 + 步骤轨迹 + 风控 + 最终回复（支持 replay 参数）
    skill-editor.tsx        # Skill 侧滑编辑器（基本信息/Prompt/模型参数/测试）
  app/
    page.tsx                # 前台 Agent 执行页
    admin/
      layout.tsx            # 后台 Layout：左侧导航 + 顶部信息
      page.tsx              # 概览 Dashboard（运行量/通过率/Top 商品/坏例）
      skills/page.tsx       # Skills 列表 + 编辑器
      tools/page.tsx        # Tools 列表 + 参数 schema + 单 Tool 测试
      conversations/page.tsx # 历史会话列表（可复跑/标 Bad Case/跳转轨迹）
      runs/[runId]/page.tsx # 单次运行轨迹详情（step-by-step I/O + 复跑 + Bad Case 标注）
      eval/page.tsx         # Eval 评测中心：一键回归 + 红绿结果 + 历史批次
      client-active-nav.tsx # 导航高亮（client 组件，拿 pathname）
    api/
      agent/run/route.ts    # POST 启动 Agent，SSE 流式返回；source=user|eval|replay
      skills/route.ts       # GET 列表 / POST 新建
      skills/[id]/route.ts  # GET 详情 / PUT 更新
      skills/[id]/test/route.ts  # POST 单独测试一个 Skill（流式）
      tools/route.ts        # GET Tool 元数据列表
      tools/[id]/test/route.ts    # POST 执行单个 Tool（同步，返回输出）
      runs/route.ts         # GET 历史运行列表
      runs/[id]/route.ts    # GET 单次运行详情（含 steps I/O/finalReply/risk）
      runs/[id]/annotate/route.ts # PATCH 标注 Bad Case / note / tags
      eval/route.ts         # GET 用例 + 最近 batch
      eval/batch/run/route.ts  # POST 启动评测批次（异步执行）
      eval/batch/[id]/route.ts  # GET 单 batch 进度/结果（轮询用）
      eval/cases/[id]/route.ts  # PATCH 切换启用/更新用例
scripts/
  test-executor.ts          # 命令行冒烟测试
```

## 内置 Skills（5）
| id | 名称 | 作用 |
|---|---|---|
| `skill_requirement` | 用户需求结构化 | 输出 JSON（intent/categories/flavorTags/budget/scenario/isNewUser/...） |
| `skill_recommend` | 商品推荐决策 | 基于已筛商品+需求选 1~3 个，返回 productId+理由 |
| `skill_reason` | 推荐理由生成 | 每件商品卖点文案 |
| `skill_script` | 客服话术生成 | 最终回复（强制使用 price.finalPrice，不许编造） |
| `skill_risk` | 风控审核 | 合规检查（禁词/承诺/价格/新人判断）→ passed + issues |

## 内置 Tools（4，纯代码）
| id | 名称 | 功能 |
|---|---|---|
| `query_products` | 查询商品 | 支持 keyword/category/flavor/tags/budget/scenario 多维过滤 |
| `query_activities` | 查询活动 | 按场景（newUser/category/threshold）过滤 |
| `query_coupons` | 查询优惠券 | 按门槛/有效期/适用品类/自动选最优 |
| `calculate_price` | 计算价格 | 满减 → 品类折扣 → 新客立减 → 优惠券 → finalPrice，输出每件商品到手价明细 |

## 关键约束
- **Planner** plan 只能引用 `skills.json` + `tools.ts` 中存在且 `enabled=true` 的能力。
- **价格/活动/优惠券** 禁止 LLM 生成，必须 Tool 获取并经 `calculate_price` 计算。
- **最后一步必须 `skill_risk`**，通过后 finalReply 才渲染。
- **Eval 评测**：expectedKeywords 支持 `A|B|C` 同义词组（组内任一命中即通过），expectedPrice > 0 时校验回复中出现的第一笔金额。
- **source 字段**：`user`（前台用户）/ `eval`（评测批次）/ `replay`（后台复跑），用于区分运行来源。
- **自动降级**：当 `data/llm-config.json` 记录的 activeProvider 所需的密钥/SDK 环境变量缺失时（例如部署后选了 openai-compatible 但没配 OPENAI_API_KEY），`getRuntimeFallbackInfo()` 会自动降级到 `classroom-fixture`（演示稳定模式），并在所有页面顶部的黄色 RuntimeBanner 中显示原因与「去模型管理配置」按钮；`GET /api/runtime` 会返回 `fallback.degraded=true`、`fallback.reason` 等字段，供前端判断。降级发生时不会把 data 文件改掉，用户配好密钥后下次刷新即自动恢复。

## 持久化写入规范（必须遵守）
- **所有 data/*.json 与 skills/<id>/SKILL.md 的写入必须走原子写**：`src/lib/fs-atomic.ts` 的 `atomicWriteTextSync` / `atomicWriteText`（temp 文件 + `fs.rename`），禁止直接 `fs.writeFile`。
  - 历史教训：多个 API 并发写同一 JSON 文件（如 skill-versions.json）时，非原子写会交错产生两份 JSON 拼接的损坏文件（`JSON.parse` 报 "Extra data"），且 rollbackSkillVersion 等读到坏文件直接 500。
  - 已改造的写入点：skill-versions.ts、ab-tests/route.ts、ab-tests/simulate/route.ts、planner.ts、llm.ts、tools-ex.ts、skills-registry.ts、store.ts（3 处）、ratings/route.ts；store.ts 的 writeJsonFile 本就是原子模式。
  - **新增任何持久化写入点时，一律 import fs-atomic**。
- **读取无内存缓存**：store/registry 每次请求直接读磁盘文件，磁盘数据被外部修改（如 git checkout 恢复）后立即生效，无需重启服务。
- **SSE 流式路由的步骤状态回写模式**（见 run/retry/route.ts）：degraded 状态在 onStepComplete 之后才能确定，需通过 `executePlan` 的 `onStepRecord` 回调回写 `newSteps`，不要在回调里引用尚未赋值的变量（TDZ）。

## LLM 模型
- 统一通过 `src/lib/llm.ts` 调用，提供同步 `chat()` 与流式 `chatStream()` 两种接口
- Provider 三选一：
  - `coze`（默认）：扣子豆包 SDK，默认模型 `doubao-seed-1-8-251228`，沙箱内自动可用
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
- **模型名翻译层**：`src/lib/llm.ts:pickModelForProvider` 在 `openai-compatible` 模式下，遇到 `^doubao|seed-|coze[_-]` 命名的模型（如 SKILL.md 中硬编码的 `doubao-seed-2-0-mini-260215`）会**自动回退到 `env.LLM_MODEL`**，并 console.warn 一次。这样部署到 DeepSeek/任何 OpenAI 兼容方时，13 个 Skill 不用改也能用
- **当前实际跑的 LLM 链路**（共 4 个 call site）：
  - `src/lib/planner.ts:169` — 计划生成
  - `src/lib/executor.ts:160` — 单步执行（每个 skill 一次）
  - `src/lib/skills-registry.ts:167` — AI 新建 Skill
  - `src/app/api/skills/[id]/test/route.ts:52` — Skills 页面"测试"按钮
  - `src/app/api/improvements/generate-prompt/route.ts:197` — 运营中心"生成 Prompt 建议"
  - `src/app/api/llm-config/test/route.ts:38` — 模型管理"测试连接"
  - 走 fixture 不真调 LLM：`src/app/api/eval/batch/run/route.ts:233`（仅 `void callLLM` 死引用）

## 开发命令
- 启动：`pnpm dev`（HMR，端口 5000）
- 构建：`pnpm build`
- 启动生产：`pnpm start`
- 静态检查：`pnpm lint` / `pnpm ts-check`
- Tools 冒烟：`npx tsx scripts/test-executor.ts`

## 常见修改点
- **新增 Skill**：`data/skills.json` 编辑，或 `/admin/skills` 页面新建；`planner.ts` 的 fallbackPlan 需要同步加入。
- **新增 Tool**：`src/lib/tools.ts` 的 `TOOLS` 注册元数据 + `runTool()` 分支；同步在 `planner.ts` 的 fallbackPlan 插入。
- **改活动/商品/券**：直接编辑 `data/*.json`。
- **Plan 编排策略**：`planner.ts` 中 `buildPlannerPrompt()` 控制 LLM 决策空间，`fallbackPlan()` 是 LLM 失败的兜底。
- **风控规则**：`data/skills.json` 中 `skill_risk.systemPrompt`；`/api/skills/[id]/test` 路由中自动注入 price 数据。
- **Eval 用例**：`data/eval_cases.json` 添加/编辑，或在 `/admin/eval` 页面启停；关键词支持 `|` 同义词分隔。
- **会话标注**：`/admin/conversations` 或 `/admin/runs/[id]` 可标 Bad Case 加 note，会写入 `runs.json`。

## 项目初始化与平台配置

### 项目识别
- **项目类型**：Web（Next.js 16 全栈 HTTP 服务）
- **部署类型**：service / web
- **运行时**：nodejs-24
- **服务端口**：5000

### .coze 配置映射
- **根 `.coze`**（`/workspace/projects/.coze`）：平台读取的唯一入口，承载 `[dev]`、`[deploy]`、`[deploy.profile]` 和 `[subprojects]` 注册
- **子项目 `.coze`**（`projects/.coze`）：记录子项目自身的 `sub_id`、`name`、类型和运行配置
- 两者 `project_type = "web"` 和 `preview_enable = "enabled"` 保持一致

### 预览链路
- **判定依据**：项目核心结果是浏览器可访问的 Web 界面（前台 Agent 执行页 + 后台运营管理页），属于 Web 预览型项目
- **预览入口**：自定义 Next.js 服务器 `src/server.ts`，通过 `pnpm tsx watch` 启动，支持 HMR
- **预览脚本**：
  - `scripts/coze-preview-build.sh`：安装依赖
  - `scripts/coze-preview-run.sh`：设置 `HOSTNAME=0.0.0.0`、`PORT=5000`，清理残留进程后启动 dev server
- **根 `.coze` 映射**：`[dev].build/run` 指向 `projects/scripts/coze-preview-*.sh`

### 部署配置
- **部署脚本**：
  - `scripts/build.sh`：安装依赖 → `next build` → `tsup` 打包 `src/server.ts` 为 `dist/server.js`
  - `scripts/start.sh`：`node dist/server.js`，端口由 `DEPLOY_RUN_PORT` 或默认 `5000` 控制
- **脚本工作目录**：所有脚本均基于 `SCRIPT_DIR` 推导 `PROJECT_DIR`，不依赖调用时的 `pwd`
- **根 `.coze` 映射**：`[deploy].build/run` 指向 `projects/scripts/build.sh` / `projects/scripts/start.sh`

### 注意事项
- 自定义服务器 `src/server.ts` 通过 `HOSTNAME` 和 `PORT` 环境变量控制绑定地址和端口
- 生产构建产物为 `dist/server.js`（由 tsup 打包），部署时直接 `node dist/server.js`
- LLM Provider 通过 `LLM_PROVIDER` 环境变量切换，默认 `coze`（扣子豆包 SDK）

### 部署环境变量（生产）
- `LLM_PROVIDER`：`coze` / `openai-compatible` / `classroom-fixture`
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL`：当 `LLM_PROVIDER=openai-compatible` 时必填
- **当前生产配置（用户已选）**：
  - `LLM_PROVIDER=openai-compatible`
  - `OPENAI_BASE_URL=https://api.deepseek.com`（OpenAI 兼容）
  - `LLM_MODEL=deepseek-v4-pro`（reasoning 模型，max_tokens 需 ≥32）
  - `data/llm-config.json` 已同步：`activeProvider=openai-compatible`，`openai-compatible.defaultModel=deepseek-v4-pro`
- 注意：`deepseek-v4-pro` 是 reasoning/thinking 模型，响应中 `content` 是最终回复，`reasoning_content` 是思考过程；本项目用 `content` 字段（项目里 `callOpenAICompatible` 解析逻辑）；若 `max_tokens` 太小可能只输出 reasoning 导致 content 为空
