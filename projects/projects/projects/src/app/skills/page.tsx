"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface SkillMeta {
  id: string;
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  requiredTools: string[];
  description?: string;
  body?: string;
}

const MODELS = [
  "doubao-seed-2-0-pro-260215",
  "doubao-seed-2-0-lite-260215",
  "doubao-seed-2-0-mini-260215",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v3-2-251201",
  "glm-4-7-251222",
  "kimi-k2-5-260127",
];

const SAMPLE_DESCRIPTIONS = [
  "提取用户售后问题中的订单号、问题类型、情绪",
  "根据用户描述判断是否需要转人工客服",
  "生成致歉话术并给出可执行的解决方案",
];

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [testInput, setTestInput] = useState('{\n  "question": "我想买点办公室零食"\n}');
  const [testOutput, setTestOutput] = useState("");
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [aiMode, setAiMode] = useState(true);
  const [listFilter, setListFilter] = useState<"all" | "enabled" | "draft">("all");

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        setSkills(d.skills || []);
        if (d.skills?.[0]) selectSkill(d.skills[0].id);
      });
  }, []);

  const active = useMemo(() => skills.find((s) => s.id === activeId), [skills, activeId]);

  const isDraft = (s: SkillMeta) =>
    s.description?.startsWith("[AI 草案]") || (s.body ?? "").startsWith("[AI 草案]");

  const visibleSkills = useMemo(() => {
    return skills.filter((s) => {
      if (listFilter === "enabled") return s.enabled;
      if (listFilter === "draft") return isDraft(s);
      return true;
    });
  }, [skills, listFilter]);

  async function selectSkill(id: string) {
    setActiveId(id);
    setTestOutput("");
    const r = await fetch(`/api/skills/${id}`);
    const d = await r.json();
    setMeta(d.skill);
    setContent(d.content);
  }

  async function saveSkill() {
    if (!meta) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/skills/${meta.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, content }),
      });
      const d = await r.json();
      setSkills((prev) => prev.map((s) => (s.id === meta.id ? d.skill : s)));
      toast.success(`已保存 ${meta.name}`);
    } catch (e) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const target = skills.find((s) => s.id === id);
    if (!target) return;
    const cleaned = {
      ...target,
      description: target.description?.replace(/^\[AI 草案\]\s*/, ""),
      body: target.body?.replace(/^\[AI 草案\]\s*/, ""),
      enabled,
    };
    const r = await fetch(`/api/skills/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: cleaned }),
    });
    const d = await r.json();
    setSkills((prev) => prev.map((s) => (s.id === id ? d.skill : s)));
    if (enabled && isDraft(target)) toast.success(`已启用 ${cleaned.name}（草案标记已移除）`);
  }

  async function runTest() {
    if (!activeId) return;
    setTesting(true);
    setTestOutput("");
    try {
      let input: any = {};
      try {
        input = JSON.parse(testInput);
      } catch {
        toast.error("输入 JSON 格式错误");
        setTesting(false);
        return;
      }
      const r = await fetch(`/api/skills/${activeId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const ev = eventLine.slice(6).trim();
          const data = dataLine.slice(5).trim();
              if (ev === "error") {
                setTestOutput((p) => p + "\n[error] " + data);
              } else {
                try {
                  const obj = JSON.parse(data);
                  if (ev === "chunk") {
                    setTestOutput((p) => p + (obj.content ?? obj.text ?? ""));
                  } else if (ev === "done") {
                    const pieces: string[] = [];
                    if (obj.durationMs != null) pieces.push(`${obj.durationMs}ms`);
                    if (obj.model) pieces.push(`model=${obj.model}`);
                    if (pieces.length) setTestOutput((p) => p + `\n\n[done ${pieces.join(" · ")}]`);
                    // 若 LLM 输出是解析后的 JSON 对象，附在后面
                    if (obj.output && typeof obj.output === "object") {
                      setTestOutput((p) => p + `\n${JSON.stringify(obj.output, null, 2)}`);
                    } else if (obj.usage) {
                      setTestOutput((p) => p + `\n${JSON.stringify(obj.usage)}`);
                    }
                  } else {
                    setTestOutput((p) => p + `\n[${ev}] ${JSON.stringify(obj)}`);
                  }
                } catch {
                  setTestOutput((p) => p + data);
                }
              }
        }
      }
    } finally {
      setTesting(false);
    }
  }

  async function createSkill() {
    if (!newName.trim()) {
      toast.error("请填写 Skill 名称");
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          description: newDesc,
          mode: aiMode ? "ai_create" : "manual",
        }),
      });
      const d = await r.json();
      setSkills((prev) => [...prev, d.skill]);
      setNewName("");
      setNewDesc("");
      selectSkill(d.skill.id);
      if (aiMode) {
        toast.success("AI 草案已生成，默认停用，确认无误后开启开关启用");
      } else {
        toast.success("已创建");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-8 py-5 bg-card/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif text-foreground">Skill 管理</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {skills.length} 个 Skill · 使用 SKILL.md 管理 Prompt 与元数据
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            新增 Skill
          </Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
        {/* skill list */}
        <aside className="border-r border-border bg-background/60 overflow-y-auto">
          <div className="p-3 space-y-2">
            <div className="flex gap-1 text-[11px]">
              {([
                ["all", "全部"],
                ["enabled", "启用中"],
                ["draft", "草案"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setListFilter(k)}
                  className={`flex-1 px-2 py-1 rounded-md transition ${
                    listFilter === k
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-70">
                    {k === "all" ? skills.length : k === "enabled" ? skills.filter((x) => x.enabled).length : skills.filter(isDraft).length}
                  </span>
                </button>
              ))}
            </div>
            {visibleSkills.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => selectSkill(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectSkill(s.id);
                  }
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition flex items-start gap-2 group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  activeId === s.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"
                }`}
              >
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.enabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="block text-sm font-medium truncate">{s.name}</span>
                    {!s.enabled && isDraft(s) ? (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-amber-600 border-amber-400 shrink-0">
                        草案
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{s.id}</span>
                </span>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(v) => {
                    toggleEnabled(s.id, v);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="scale-75 data-[state=checked]:bg-primary"
                />
              </div>
            ))}
          </div>
        </aside>

        {/* editor */}
        <main className="overflow-y-auto">
          {active && meta ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold">{meta.name}</h2>
                    <Badge variant="outline" className="font-mono text-xs">{meta.id}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{meta.description}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => selectSkill(meta.id)}>重置</Button>
                  <Button onClick={saveSkill} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
                </div>
              </div>

              <Tabs defaultValue="basic">
                <TabsList>
                  <TabsTrigger value="basic">基本信息</TabsTrigger>
                  <TabsTrigger value="prompt">SKILL.md</TabsTrigger>
                  <TabsTrigger value="model">模型参数</TabsTrigger>
                  <TabsTrigger value="test">测试</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4 mt-4">
                  <Card>
                    <CardContent className="pt-6 space-y-3">
                      <label className="block text-sm">
                        <span className="text-muted-foreground">名称</span>
                        <Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} className="mt-1" />
                      </label>
                      <label className="block text-sm">
                        <span className="text-muted-foreground">简介</span>
                        <Input value={meta.description || ""} onChange={(e) => setMeta({ ...meta, description: e.target.value })} className="mt-1" />
                      </label>
                      <label className="flex items-center gap-2 pt-2">
                        <Switch checked={meta.enabled} onCheckedChange={(v) => setMeta({ ...meta, enabled: v })} />
                        <span className="text-sm">启用此 Skill（Planner 可调用）</span>
                      </label>
                      <div>
                        <span className="text-sm text-muted-foreground">必需 Tool：</span>
                        <div className="flex gap-1 flex-wrap mt-1">
                          {(meta.requiredTools || []).map((t) => (
                            <Badge key={t} variant="secondary">{t}</Badge>
                          ))}
                          {(meta.requiredTools || []).length === 0 && <span className="text-xs text-muted-foreground">无</span>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="prompt" className="mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">SKILL.md 内容</CardTitle>
                      <CardDescription>
                        文件路径：<code className="font-mono">skills/{meta.id}/SKILL.md</code>
                        ，使用 YAML frontmatter + Markdown Prompt
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="font-mono text-xs min-h-[480px] leading-relaxed"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="model" className="space-y-4 mt-4">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <label className="block text-sm">
                        <span className="text-muted-foreground">模型（SKILL.md 中声明的模型名）</span>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm mt-1"
                          value={meta.model}
                          onChange={(e) => setMeta({ ...meta, model: e.target.value })}
                        >
                          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                      {(meta as any).modelTranslated && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          ⚠️ 当前运行模式是 <b>OpenAI 兼容（DeepSeek）</b>，豆包/扣子系列模型名会被自动翻译为环境变量
                          <code className="px-1 font-mono">LLM_MODEL</code>（当前实际调用：
                          <b className="font-mono">{(meta as any).effectiveModel || "deepseek-chat"}</b>）。
                          如果想直接显示 DeepSeek 模型名，可把下拉框改为 <code className="font-mono">deepseek-chat</code> 或
                          <code className="font-mono">deepseek-reasoner</code> 并保存。
                        </div>
                      )}
                      {!(meta as any).modelTranslated && (meta as any).effectiveModel && (meta as any).effectiveModel !== meta.model && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          ℹ️ 实际运行模型：<b className="font-mono">{(meta as any).effectiveModel}</b>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block text-sm">
                          <span className="text-muted-foreground">Temperature ({meta.temperature})</span>
                          <input
                            type="range" min={0} max={1} step={0.1}
                            value={meta.temperature}
                            onChange={(e) => setMeta({ ...meta, temperature: Number(e.target.value) })}
                            className="w-full mt-1"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-muted-foreground">Max Tokens</span>
                          <Input
                            type="number" value={meta.maxTokens}
                            onChange={(e) => setMeta({ ...meta, maxTokens: Number(e.target.value) })}
                            className="mt-1"
                          />
                        </label>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="test" className="space-y-4 mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">独立测试</CardTitle>
                      <CardDescription>直接调用此 Skill（不走 Planner，可用于验证 Prompt）</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        value={testInput}
                        onChange={(e) => setTestInput(e.target.value)}
                        className="font-mono text-xs min-h-[120px]"
                        placeholder='{"question":"..."}'
                      />
                      <Button size="sm" onClick={runTest} disabled={testing}>{testing ? "测试中..." : "运行测试"}</Button>
                      <pre className="text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap max-h-[300px] overflow-auto border border-border">
{testOutput || "测试结果将显示在这里"}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">请选择一个 Skill</div>
          )}
        </main>
      </div>

      {/* Create dialog */}
      {creating !== false && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setCreating(false)}>
          <Card className="w-[520px]" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>新增 Skill</CardTitle>
              <CardDescription>手动创建或用自然语言描述，AI 帮你生成 SKILL.md 草案</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant={aiMode ? "default" : "outline"} onClick={() => setAiMode(true)}>AI 生成草案</Button>
                <Button size="sm" variant={!aiMode ? "default" : "outline"} onClick={() => setAiMode(false)}>手动创建</Button>
              </div>
              <Input placeholder="Skill 名称（英文 id 会自动生成）" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Textarea
                placeholder={aiMode ? "例如：判断用户投诉严重程度，是否需要转人工..." : "Skill 描述"}
                value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                className="min-h-[120px]"
              />
              {aiMode && (
                <div className="text-xs text-muted-foreground">
                  示例：{SAMPLE_DESCRIPTIONS.map((s, i) => (
                    <button key={i} className="underline mr-2" onClick={() => setNewDesc(s)}>{s}</button>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
                <Button onClick={createSkill} disabled={!newName.trim()}>{aiMode ? "AI 生成" : "创建"}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
