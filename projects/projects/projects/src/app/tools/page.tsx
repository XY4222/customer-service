"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type ToolConfig = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  implementation: "local" | "mcp";
  sourceFile?: string;
  dataSource?: string;
  mcpServer?: string;
  category: "data" | "calc" | "write" | "knowledge" | "external";
  parameters?: { name: string; type?: string; description: string; required: boolean; default?: unknown }[];
  demoInput?: Record<string, unknown>;
  builtin?: boolean;
};

type McpServer = { id: string; name: string; url: string; enabled: boolean; tools?: { name: string; description: string }[] };

const categoryLabels: Record<string, { label: string; color: string; icon: string }> = {
  data:      { label: "数据查询", color: "bg-sky-100 text-sky-700 border-sky-200",       icon: "🔍" },
  calc:      { label: "计算解析", color: "bg-violet-100 text-violet-700 border-violet-200", icon: "🧮" },
  write:     { label: "写入操作", color: "bg-rose-100 text-rose-700 border-rose-200",     icon: "✏️" },
  knowledge: { label: "知识库",   color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: "📚" },
  external:  { label: "外部服务", color: "bg-amber-100 text-amber-700 border-amber-200",   icon: "🌐" },
};

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState<string>("{\n  \n}");
  const [testOutput, setTestOutput] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [newMcp, setNewMcp] = useState({ name: "", url: "" });
  const [connecting, setConnecting] = useState(false);

  // 选中 Tool 时自动填充 demoInput
  useEffect(() => {
    const t = tools.find((x) => x.id === selectedId);
    if (!t) return;
    if (t.demoInput && Object.keys(t.demoInput).length > 0) {
      setTestInput(JSON.stringify(t.demoInput, null, 2));
      setTestOutput("");
    }
  }, [selectedId, tools]);

  const load = async () => {
    const res = await fetch("/api/tools");
    const d = await res.json();
    setTools(d.tools || []);
    setMcpServers(d.mcpServers || []);
    if (!selectedId && d.tools?.[0]) setSelectedId(d.tools[0].id);
  };
  useEffect(() => {
    load();
  }, []);

  const selected = tools.find((t) => t.id === selectedId) || null;

  const toggle = async (id: string, enabled: boolean) => {
    await fetch("/api/tools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    toast.success(`已${enabled ? "启用" : "停用"} Tool`);
    load();
  };

  const runTest = async () => {
    if (!selected) return;
    setTesting(true);
    setTestOutput("");
    try {
      const parsed = JSON.parse(testInput);
      const res = await fetch(`/api/tools/${selected.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: parsed }),
      });
      const d = await res.json();
      setTestOutput(JSON.stringify(d, null, 2));
      if (d.success) toast.success(`执行成功 · ${d.durationMs}ms`);
      else toast.error("执行失败，查看输出");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestOutput(`JSON 解析错误：${msg}`);
      toast.error("输入 JSON 格式错误");
    } finally {
      setTesting(false);
    }
  };

  const connectMcp = async () => {
    if (!newMcp.name || !newMcp.url) {
      toast.error("请填写名称和 URL");
      return;
    }
    setConnecting(true);
    try {
      await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect_mcp", ...newMcp }),
      });
      toast.success("MCP Server 已连接（演示）");
      setNewMcp({ name: "", url: "" });
      load();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* 工具列表 */}
      <aside className="w-72 border-r border-border p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Tools 管理</h2>
            <p className="text-xs text-muted-foreground mt-0.5">共 {tools.filter((t) => t.enabled).length}/{tools.length} 启用</p>
          </div>
        </div>
        <div className="space-y-2">
          {tools.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedId(t.id);
                setTestOutput("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(t.id);
                  setTestOutput("");
                }
              }}
              className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                selectedId === t.id
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{t.name}</span>
                    <span
                      className={`shrink-0 inline-flex items-center gap-0.5 rounded-sm px-1 py-0 text-[9px] leading-none border ${
                        (categoryLabels[t.category] || categoryLabels.data).color
                      }`}
                    >
                      {(categoryLabels[t.category] || categoryLabels.data).icon}{" "}
                      {(categoryLabels[t.category] || categoryLabels.data).label}
                    </span>
                    {t.implementation === "mcp" && (
                      <Badge variant="outline" className="text-[10px] px-1">MCP</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{t.id}</div>
                </div>
                <Switch
                  checked={t.enabled}
                  onCheckedChange={(v) => toggle(t.id, v)}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold mb-3">MCP Servers</h3>
          <div className="space-y-2 mb-3">
            {mcpServers.map((s) => (
              <div key={s.id} className="p-2 border border-border rounded-md text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600">已连接</Badge>
                </div>
                <div className="text-muted-foreground truncate mt-0.5">{s.url}</div>
                {s.tools && s.tools.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1">导入 {s.tools.length} 个 Tool</div>
                )}
              </div>
            ))}
            {mcpServers.length === 0 && (
              <p className="text-xs text-muted-foreground">暂无 MCP Server</p>
            )}
          </div>
          <div className="space-y-2 pt-2 border-t border-border/60">
            <Label className="text-xs">连接新 MCP Server</Label>
            <Input
              placeholder="名称（如 my-tools）"
              value={newMcp.name}
              onChange={(e) => setNewMcp({ ...newMcp, name: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              placeholder="MCP URL (http://...)"
              value={newMcp.url}
              onChange={(e) => setNewMcp({ ...newMcp, url: e.target.value })}
              className="h-8 text-xs"
            />
            <Button size="sm" className="w-full h-8 text-xs" onClick={connectMcp} disabled={connecting}>
              {connecting ? "连接中..." : "连接并导入"}
            </Button>
          </div>
        </div>
      </aside>

      {/* 详情 */}
      <main className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <div className="max-w-3xl space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-semibold">{selected.name}</h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] border ${
                    (categoryLabels[selected.category] || categoryLabels.data).color
                  }`}
                >
                  {(categoryLabels[selected.category] || categoryLabels.data).icon}{" "}
                  {(categoryLabels[selected.category] || categoryLabels.data).label}
                </span>
                <Badge variant="outline">{selected.implementation === "mcp" ? "MCP 远程" : "本地代码"}</Badge>
                <Badge variant={selected.enabled ? "default" : "secondary"}>
                  {selected.enabled ? "启用" : "停用"}
                </Badge>
                {selected.category === "write" && (
                  <Badge variant="destructive" className="text-[10px]">有副作用</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{selected.description}</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{selected.id}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {selected.sourceFile && (
                <div className="p-2 bg-muted/40 rounded">
                  <div className="text-muted-foreground">源码文件</div>
                  <code className="text-foreground">{selected.sourceFile}</code>
                </div>
              )}
              {selected.dataSource && (
                <div className="p-2 bg-muted/40 rounded">
                  <div className="text-muted-foreground">数据源</div>
                  <code className="text-foreground">{selected.dataSource}</code>
                </div>
              )}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">参数 Schema</CardTitle>
              </CardHeader>
              <CardContent>
                {selected.parameters && selected.parameters.length > 0 ? (
                  <div className="space-y-2">
                    {selected.parameters.map((p) => (
                      <div key={p.name} className="flex items-start gap-2 text-xs p-2 border border-border rounded">
                        <code className="font-mono font-medium shrink-0">{p.name}</code>
                        {p.type && (
                          <Badge variant="secondary" className="h-4 text-[10px] px-1 shrink-0 font-mono">
                            {p.type}
                          </Badge>
                        )}
                        {p.required && <Badge variant="destructive" className="h-4 text-[10px] px-1 shrink-0">必填</Badge>}
                        <span className="text-muted-foreground flex-1">{p.description}</span>
                        {p.default !== undefined && (
                          <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                            默认: {JSON.stringify(p.default)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">无参数</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Tool 测试</CardTitle>
                  <Button
                    size="sm"
                    onClick={runTest}
                    disabled={!selected.enabled || testing}
                    className="px-4"
                  >
                    {testing ? "执行中..." : "▶ 执行 Tool"}
                  </Button>
                </div>
                {!selected.enabled && (
                  <p className="text-xs text-destructive">请先启用 Tool</p>
                )}
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="input">
                  <TabsList className="mb-3">
                    <TabsTrigger value="input">输入</TabsTrigger>
                    <TabsTrigger value="output">输出</TabsTrigger>
                  </TabsList>
                  <TabsContent value="input">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs">输入 JSON</Label>
                      {selected.demoInput && Object.keys(selected.demoInput).length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setTestInput(JSON.stringify(selected.demoInput, null, 2))}
                        >
                          填充示例
                        </Button>
                      )}
                    </div>
                    <textarea
                      className="w-full h-48 font-mono text-xs p-3 border border-border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      spellCheck={false}
                      placeholder="在此输入 Tool 参数 JSON，或点击右上角「填充示例」快速开始"
                    />
                  </TabsContent>
                  <TabsContent value="output">
                    <pre className="w-full h-60 p-3 bg-muted/30 border border-border rounded-lg overflow-auto text-xs font-mono whitespace-pre-wrap">
                      {testOutput || "尚未执行，点击右上角「▶ 执行 Tool」开始"}
                    </pre>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">选择左侧 Tool 查看详情</div>
        )}
      </main>
    </div>
  );
}
