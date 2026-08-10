"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Save, Play, Loader2, History, RotateCcw } from "lucide-react";
import type { SkillManifest } from "@/lib/skills-registry";

const MODEL_OPTIONS = [
  { value: "doubao-seed-1-8-251228", label: "Doubao Seed 1.8（推荐）" },
  { value: "doubao-seed-2-0-mini-260215", label: "Doubao Seed 2.0 Mini" },
  { value: "doubao-seed-2-0-lite-260215", label: "Doubao Seed 2.0 Lite" },
  { value: "deepseek-v3-2-251201", label: "DeepSeek V3.2" },
  { value: "kimi-k2-5-260127", label: "Kimi K2.5" },
];

interface SkillEditorProps {
  skillId: string;
  onSaved: (skill: SkillManifest) => void;
}

export function SkillEditor({ skillId, onSaved }: SkillEditorProps) {
  const [skill, setSkill] = useState<SkillManifest | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState('{\n  "question": "我想买点办公室零食，预算 30 元，要麻辣口味"\n}');
  const [testResult, setTestResult] = useState<{
    output: unknown;
    durationMs: number;
    streaming?: boolean;
    parsed?: unknown;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // 版本历史
  const [versions, setVersions] = useState<
    Array<{ id: string; message: string; createdAt: string; source: string }>
  >([]);
  const [selectedVersion, setSelectedVersion] = useState<{ id: string; body: string; createdAt: string } | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    fetch(`/api/skills/${skillId}`)
      .then((r) => r.json())
      .then((d) => setSkill(d.skill))
      .catch(() => toast.error("加载 SkillManifest 失败"));
    fetchVersions();
  }, [skillId]);

  const fetchVersions = async () => {
    try {
      const r = await fetch(`/api/skills/${skillId}/versions`);
      const d = await r.json();
      setVersions(d.versions || []);
    } catch {}
  };

  const openVersion = async (vid: string) => {
    setLoadingVersion(true);
    try {
      const r = await fetch(`/api/skills/${skillId}/versions/${vid}`);
      const d = await r.json();
      if (d.version) setSelectedVersion(d.version);
    } catch {
      toast.error("加载版本内容失败");
    } finally {
      setLoadingVersion(false);
    }
  };

  const handleRollback = async (vid: string) => {
    if (!confirm(`确定回滚到版本 ${vid.slice(-6)} 吗？当前版本会自动保存快照。`)) return;
    setRollingBack(true);
    try {
      const r = await fetch(`/api/skills/${skillId}/versions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: vid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "回滚失败");
      toast.success("已回滚到该版本");
      // 刷新 skill 与版本列表
      const fresh = await fetch(`/api/skills/${skillId}`).then((x) => x.json());
      setSkill(fresh.skill);
      setSelectedVersion(null);
      await fetchVersions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "回滚失败");
    } finally {
      setRollingBack(false);
    }
  };

  const handleSnapshot = async () => {
    try {
      await fetch(`/api/skills/${skillId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "手动快照" }),
      });
      toast.success("已保存快照");
      await fetchVersions();
    } catch {
      toast.error("快照保存失败");
    }
  };

  if (!skill) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const update = <K extends keyof SkillManifest>(key: K, value: SkillManifest[K]) => {
    setSkill({ ...skill, [key]: value });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skillId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      if (data.skill) {
        setSkill(data.skill);
        onSaved(data.skill);
        toast.success("已保存");
      } else {
        toast.error(data.error || "保存失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    let parsedInput: Record<string, unknown> = {};
    try {
      const raw = testInput.trim();
      if (raw) parsedInput = JSON.parse(raw);
    } catch (err) {
      setTestError("测试输入不是合法 JSON: " + (err instanceof Error ? err.message : ""));
      setTesting(false);
      return;
    }
    try {
      const res = await fetch(`/api/skills/${skillId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: parsedInput }),
      });
      if (!res.ok || !res.body) {
        setTestError(`请求失败: HTTP ${res.status}`);
        setTesting(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      let finalOutput: unknown = "";
      let finalMs = 0;
      const startTime = Date.now();
      setTestResult({ output: "", durationMs: 0 });
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 以 "\n\n" 切分事件块
        const sepIdx = (): number => {
          const i = buf.indexOf("\n\n");
          if (i >= 0) return i;
          // 部分环境用 \r\n\r\n
          const j = buf.indexOf("\r\n\r\n");
          return j >= 0 ? j + 2 : -1;
        };
        while (true) {
          const idx = sepIdx();
          if (idx < 0) break;
          const rawBlock = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let eventType = "message";
          const dataLines: string[] = [];
          for (const line of rawBlock.split(/\r?\n/)) {
            if (!line) continue;
            if (line.startsWith(":")) continue; // comment
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          const payload = dataLines.join("\n");
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (eventType === "chunk" || evt.type === "chunk") {
              accumulated += evt.content ?? evt.delta ?? "";
              setTestResult({
                output: accumulated,
                durationMs: Date.now() - startTime,
                streaming: true,
              });
            } else if (eventType === "done" || evt.type === "done") {
              finalOutput = evt.output ?? accumulated;
              finalMs = evt.durationMs ?? Date.now() - startTime;
            } else if (eventType === "error" || evt.type === "error") {
              setTestError(evt.error ?? "测试失败");
            }
          } catch {
            /* skip non-JSON line */
          }
        }
      }
      setTestResult({ output: finalOutput || accumulated, durationMs: finalMs, streaming: false });
      toast.success(`测试完成 · ${finalMs}ms`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Tabs defaultValue="config" className="w-full">
      <TabsList>
        <TabsTrigger value="config">配置</TabsTrigger>
        <TabsTrigger value="prompt">Prompt</TabsTrigger>
        <TabsTrigger value="test">测试</TabsTrigger>
        <TabsTrigger value="versions"><History className="w-3.5 h-3.5 mr-1 inline" />版本</TabsTrigger>
      </TabsList>

      <TabsContent value="config" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">名称</Label>
            <Input
              id="name"
              value={skill.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="enabled">启用状态</Label>
            <div className="flex items-center gap-2 h-10">
              <Switch
                id="enabled"
                checked={skill.enabled}
                onCheckedChange={(v) => update("enabled", v)}
              />
              <span className="text-sm text-muted-foreground">
                {skill.enabled ? "已启用（前台 Planner 可调用）" : "已禁用"}
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desc">描述</Label>
          <Textarea
            id="desc"
            value={skill.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="model">模型</Label>
            <Select
              value={skill.model}
              onValueChange={(v) => update("model", v)}
            >
              <SelectTrigger id="model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="temp">
              Temperature
              <span className="text-muted-foreground ml-1.5 font-normal">
                {skill.temperature.toFixed(1)}
              </span>
            </Label>
            <Input
              id="temp"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={skill.temperature}
              onChange={(e) => update("temperature", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxTokens">Max Tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              min={256}
              max={8192}
              step={256}
              value={skill.maxTokens}
              onChange={(e) => update("maxTokens", Number(e.target.value))}
            />
          </div>
        </div>
        <div className="pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存配置
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="prompt" className="space-y-3 mt-4">
        <div className="space-y-2">
          <Label htmlFor="prompt">SKILL.md 内容（Prompt）</Label>
          <Textarea
            id="prompt"
            value={skill.body}
            onChange={(e) => update("body", e.target.value)}
            rows={18}
            className="font-mono text-xs leading-relaxed resize-y"
          />
        </div>
        <div className="pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存 Prompt
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="test" className="space-y-3 mt-4">
        <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground">
          填写 JSON 格式的测试输入（如 {"{"} "question": "..." {"}"}），保存的 prompt 会立即生效。
        </div>
        <div className="space-y-2">
          <Label htmlFor="testInput">测试输入（JSON）</Label>
          <Textarea
            id="testInput"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
        </div>
        <Button onClick={runTest} disabled={testing}>
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          运行测试
        </Button>

        {testError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 text-xs font-mono whitespace-pre-wrap">
            {testError}
          </div>
        )}

        {testResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-normal">
                {testResult.durationMs}ms{testResult.streaming ? " · 流式输出中" : ""}
              </Badge>
              <span>输出</span>
            </div>
            {(() => {
              const raw =
                typeof testResult.output === "string"
                  ? testResult.output
                  : JSON.stringify(testResult.output, null, 2);
              let parsed: unknown = null;
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = null;
              }
              return parsed ? (
                <pre className="rounded-md bg-muted/50 p-3 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(parsed, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                  {raw || <span className="text-muted-foreground italic">（无输出）</span>}
                </div>
              );
            })()}
          </div>
        )}
      </TabsContent>

      <TabsContent value="versions" className="mt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">版本历史</div>
            <div className="text-xs text-muted-foreground">
              每次保存 Prompt 或应用改进补丁前会自动存快照，最多保留 30 条
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleSnapshot}>
            <Save className="w-3.5 h-3.5 mr-1" />立即存快照
          </Button>
        </div>
        <div className="grid grid-cols-5 gap-3 h-96">
          <div className="col-span-2 border rounded-lg overflow-hidden">
            <ScrollArea className="h-full">
              {versions.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">暂无版本快照</div>
              ) : (
                <ul className="divide-y">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className={`px-3 py-2.5 cursor-pointer transition hover:bg-muted/50 ${
                        selectedVersion?.id === v.id ? "bg-primary/10" : ""
                      }`}
                      onClick={() => openVersion(v.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="outline"
                            className={
                              v.source === "patch"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : v.source === "rollback"
                                ? "bg-sky-50 text-sky-700 border-sky-200"
                                : "bg-muted text-muted-foreground"
                            }
                          >
                            {v.source === "patch" ? "补丁" : v.source === "rollback" ? "回滚" : "保存"}
                          </Badge>
                          <span className="text-sm truncate">{v.message || "未命名"}</span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        {v.id} · {new Date(v.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
          <div className="col-span-3 border rounded-lg flex flex-col">
            {loadingVersion ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : selectedVersion ? (
              <>
                <div className="px-3 py-2 border-b flex items-center justify-between">
                  <div className="text-sm font-mono">{selectedVersion.id} · {new Date(selectedVersion.createdAt).toLocaleString("zh-CN")}</div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleRollback(selectedVersion.id)}
                    disabled={rollingBack}
                  >
                    {rollingBack ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    )}
                    回滚到此版本
                  </Button>
                </div>
                <pre className="flex-1 p-3 overflow-auto text-xs font-mono bg-muted/30 whitespace-pre-wrap m-0">
                  {selectedVersion.body}
                </pre>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                左侧选择一个版本查看内容
              </div>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
