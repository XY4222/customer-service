import { AgentConsole } from "@/components/agent-console";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Agent 执行</h1>
        <p className="text-sm text-muted-foreground mt-1">
          输入客服问题，Planner 自动规划，Executor 逐步执行并展示每一步的输入输出。
        </p>
      </section>
      <AgentConsole />
    </div>
  );
}
