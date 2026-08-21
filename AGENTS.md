# AGENTS.md

## 项目概述
**零食电商客服 Plan + Skill 可配置执行平台 (SnackOps)**

一个可演示、可运营的客服 Agent 编排平台。用户前台提问 → Planner 生成执行计划 → Executor 逐步执行（SSE 流式推送每一步 I/O）→ 风控审核后返回最终回复。后台提供 Skills/Tools 管理、会话审计、Eval 批量回归评测等运营能力。

## 技术栈
- **框架**: Next.js 16 (App Router, webpack 模式)
- **语言**: TypeScript
- **运行时**: Node.js 24
- **包管理器**: pnpm
- **样式**: Tailwind CSS v4
- **UI 组件**: shadcn/ui (Radix UI)
- **数据库**: JSON 文件持久化 (data/*.json) + Drizzle ORM + PostgreSQL (可选)
- **LLM**: coze-coding-dev-sdk (doubao-seed) / OpenAI Compatible / classroom-fixture 降级
- **构建**: Next.js build + tsup (server.ts 打包)

## 目录结构
```
/workspace/projects/                          # 工作区根
  .coze                                       # 根 .coze（平台入口）
  projects/projects/projects/projects/        # 技术项目根（Next.js）
    .coze                                     # 子项目 .coze
    .preview                                  # 预览端口声明
    package.json
    next.config.ts
    src/
      app/                                    # Next.js App Router 页面
        page.tsx                              # 前台 Agent 执行页
        admin/                                # 后台管理
        api/                                  # API Routes (SSE 流式)
      lib/                                    # 核心逻辑
        llm.ts                                # LLM 客户端
        store.ts                              # JSON 持久层
        tools.ts                              # Tool 实现
        planner.ts                            # Planner
        executor.ts                           # Executor
      components/                             # React 组件
    data/                                     # JSON 数据库
    scripts/                                  # 构建/启动/预览脚本
```

## 关键入口
- **前台页面**: `src/app/page.tsx` → `src/components/agent-console.tsx`
- **后台管理**: `src/app/admin/` (Skills/Tools/会话/Eval/模型管理)
- **Agent API**: `src/app/api/agent/run/route.ts` (POST, SSE 流式)
- **LLM 调用**: `src/lib/llm.ts` (chat / chatStream)
- **预览脚本**: `scripts/coze-preview-build.sh` + `scripts/coze-preview-run.sh`
- **部署脚本**: `scripts/build.sh` + `scripts/start.sh`

## 运行与预览
- **预览启动**: `bash scripts/coze-preview-build.sh` → `bash scripts/coze-preview-run.sh`
- **预览端口**: 从 `.preview` 读取 `expose_port`，fallback 5000
- **开发模式**: `pnpm tsx watch src/server.ts` (自定义 server，非 next dev)
- **验证命令**: `pnpm validate` (typecheck + lint)

## 部署配置
- **profile**: `kind = "service"`, `flavor = "web"`
- **构建**: `pnpm install` → `next build` → `tsup src/server.ts`
- **启动**: `node dist/server.js`，端口 5000

## 用户偏好与长期约束
- 包管理器只用 pnpm，禁止 npm/yarn
- 端口固定 5000，从 .preview 读取，不 hardcode
- LLM 默认使用 coze-coding-dev-sdk (doubao-seed)

## 常见问题和预防
- Next.js 多 lockfile 警告：可忽略，不影响功能
- url.parse() deprecation warning：Node.js 内置行为，不影响功能
- validate.sh 依赖 COZE_WORKSPACE_PATH 环境变量，本地运行需确保正确
- **路径体系**（预览问题根因，勿再踩）：git root 即工作区根 `/workspace/projects`（目录名本身是 projects），技术项目 tracked 于相对路径 `projects/projects/projects/`（绝对路径 4 个 projects 段）。根 `.coze` 的 `[dev]`/`[deploy]` 相对路径以工作区根为基准解析，必须是 3 段 `projects/projects/projects/scripts/...`——多写一层平台执行器就找不到脚本，预览直接起不来。
- **test_run 管线行为**：命令数组是**并行执行**的，有依赖关系的命令（尤其写同一 data 文件的）必须用 `&&` 串联成单条命令字符串实现串行化，否则会 404 竞态或并发写坏 JSON 文件。管线会把 curl 重写为追加 `-w '\nHTTP_CODE:%{http_code}'`，curl 对 HTTP 错误码仍 exit 0；stdout 重定向到文件的 body 会被 HTTP_CODE 尾巴污染，构造复杂请求体时用 python 从 data 源文件生成。
