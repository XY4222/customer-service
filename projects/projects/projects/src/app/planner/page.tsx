"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Save, Eye, Play, Zap, AlertTriangle } from "lucide-react";
import type { PlannerConfig } from "@/lib/planner";

type SkillLite = { id: string; name: string; enabled: boolean };

const MODELS: { id: string; label: string; hint?: string }[] = [
  { id: "doubao-seed-2-0-pro-260215", label: "豆包 Seed 2.0 Pro", hint: "严谨推理" },
  { id: "doubao-seed-2-0-lite-260215", label: "豆包 Seed 2.0 Lite", hint: "快速规划（推荐）" },
  { id: "doubao-seed-2-0-mini-260215", label: "豆包 Seed 2.0 Mini", hint: "低成本" },
  { id: "deepseek-chat", label: "DeepSeek V3", hint: "通用强推理" },
  { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)", hint: "深度推理" },
  { id: "deepseek-v3-2-251201", label: "DeepSeek V3.2", hint: "新版" },
  { id: "glm-4-7-251222", label: "智谱 GLM-4-7" },
  { id: "kimi-k2-5-260127", label: "Kimi K2.5" },
];

export default function PlannerPage() {
  const [skills, setSkills] = useState<SkillLite[]>([]);
  const [config, setConfig] = useState<PlannerConfig | null>(null);
  const [effectiveModel, setEffectiveModel] = useState<string>("");
  const [modelTranslated, setModelTranslated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewQ, setPreviewQ] = useState("我想买点办公室零食，预算 30 元，要麻辣口味");
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    fetch("/api/planner").then((r) => r.json()).then((d) => {
      setConfig(d.config);
      setEffectiveModel(d.effectiveModel || d.config.model);
      setModelTranslated(!!d.modelTranslated);
    });
    fetch("/api/skills").then((r) => r.json()).then((d) =>
      setSkills((d.skills || []).map((s: any) => ({ id: s.id, name: s.name, enabled: s.enabled })))
    );
  }, []);

  const toolList = useMemo(() => [
    { id: "query_products", name: "查询商品" },
    { id: "query_activities", name: "查询活动" },
    { id: "query_coupons", name: "查询优惠券" },
    { id: "calculate_price", name: "计算价格" },
    { id: "query_order", name: "查询订单" },
    { id: "query_return_policy", name: "退换货政策" },
  ], []);

  const toggleList = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) toast.success("Planner 配置已保存");
      else toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function doPreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/planner/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: previewQ }),
      });
      const data = await res.json();
      if (data.error) toast.error(data.error);
      else setPreview(data);
    } finally {
      setPreviewing(false);
    }
  }

  if (!config) return <div className="p-8 text-muted-foreground">加载中...</div>;

  const riskOn = skills.find((s) => s.id === "risk-check")?.enabled;
  const riskMandatory = config.mandatorySkills.includes("risk-check");

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Planner 管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            配置 Planner 的 System Prompt、必经 Skill、基础 Tool 与价格 Tool 集合。Planner 只能调用已启用的能力。
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-primary hover:bg-primary/90">
          <Save className="w-4 h-4 mr-1" />{saving ? "保存中..." : "保存配置"}
        </Button>
      </div>

      <Tabs defaultValue="prompt" className="space-y-4">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="mandatory">必经 Skill</TabsTrigger>
          <TabsTrigger value="tools">Tool 分组</TabsTrigger>
          <TabsTrigger value="model">模型参数</TabsTrigger>
          <TabsTrigger value="preview">执行空间预览</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Planner System Prompt</CardTitle>
              <CardDescription>
                这是 Planner 生成执行计划时看到的系统指令。可以调整推理风格、约束、输出格式等。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={config.systemPrompt}
                onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                rows={20}
                className="font-mono text-xs leading-relaxed"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mandatory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">必经 Skill（任何场景都要执行）</CardTitle>
              <CardDescription>勾选后 Planner 必须安排这些 Skill，即使 LLM 认为不需要也会强制补上。风险审核必须强制。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {skills.map((s) => {
                const on = config.mandatorySkills.includes(s.id);
                const isRisk = s.id === "risk-check";
                return (
                  <div key={s.id} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${!s.enabled ? "opacity-40" : ""}`}>
                    <div>
                      <div className="font-medium text-sm flex items-center gap-1">
                        {s.name}
                        {isRisk && <Badge className="bg-primary text-white text-[10px] ml-1">强制</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.id}</div>
                    </div>
                    <Switch
                      checked={on || isRisk}
                      disabled={!s.enabled || isRisk}
                      onCheckedChange={() =>
                        !isRisk && setConfig({ ...config, mandatorySkills: toggleList(config.mandatorySkills, s.id) })
                      }
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {!riskOn && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <b>risk-check 已停用</b>：此时前台不会生成未经风控的最终回复。
                建议在 Skills 管理页重新启用 <code>risk-check</code>。
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">基础 Tool（用户请求商品时默认调用）</CardTitle>
              <CardDescription>通常包含商品查询。LLM 会在判定为非购物意图时跳过。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {toolList.map((t) => {
                const on = config.basicTools.includes(t.id);
                return (
                  <Label key={t.id} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setConfig({ ...config, basicTools: toggleList(config.basicTools, t.id) })}
                      className="accent-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.id}</div>
                    </div>
                  </Label>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">价格相关 Tool（有推荐商品时必调）</CardTitle>
              <CardDescription>最终价格必须经由这些 Tool 链计算，LLM 不得自行编造。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {toolList.map((t) => {
                const on = config.priceTools.includes(t.id);
                return (
                  <Label key={t.id} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setConfig({ ...config, priceTools: toggleList(config.priceTools, t.id) })}
                      className="accent-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.id}</div>
                    </div>
                  </Label>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模型参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div>
                <Label htmlFor="model">模型</Label>
                <select
                  id="model"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm mt-1"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.id}){m.hint ? ` — ${m.hint}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  推荐 doubao-seed-2-0-lite 用于快速规划，pro 用于更严谨推理。
                </p>
                {modelTranslated ? (
                  <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      当前运行模式是 <b>OpenAI 兼容（DeepSeek）</b>，豆包/扣子系列模型名会被自动翻译为环境变量{" "}
                      <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">LLM_MODEL</code>
                      （当前实际调用：<b>{effectiveModel}</b>）。如需直接显示 DeepSeek 模型，可把模型名改为 <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">deepseek-chat</code> 保存。
                    </span>
                  </div>
                ) : effectiveModel ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    ℹ️ 实际运行模型：<b>{effectiveModel}</b>
                  </p>
                ) : null}
              </div>
              <div>
                <Label>temperature: {config.temperature.toFixed(2)}</Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.temperature}
                  onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                  className="w-full accent-primary mt-1"
                />
              </div>
              <div>
                <Label>maxTokens</Label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || 800 })}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="w-4 h-4" />执行空间预览
              </CardTitle>
              <CardDescription>
                输入一个示例问题，可以查看 Planner 实际收到的 Skills/Tools 列表和完整 System Prompt。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={previewQ}
                  onChange={(e) => setPreviewQ(e.target.value)}
                  placeholder="输入示例问题..."
                />
                <Button onClick={doPreview} disabled={previewing} className="bg-primary hover:bg-primary/90 whitespace-nowrap">
                  <Play className="w-4 h-4 mr-1" />{previewing ? "生成中..." : "预览"}
                </Button>
              </div>
              {preview && (
                <div className="space-y-3 pt-3 border-t">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="可用 Skill" value={preview.summary.enabledSkills} />
                    <Stat label="可用 Tool" value={preview.summary.enabledTools} />
                    <Stat label="必经 Skill" value={preview.summary.mandatorySkills.length} />
                    <Stat label="风控启用" value={preview.summary.riskEnabled ? "是" : "否"}
                      tone={preview.summary.riskEnabled ? "success" : "danger"}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">可用 Skills</div>
                    <div className="flex flex-wrap gap-1">
                      {preview.skillList.map((s: any) => (
                        <Badge key={s.id} variant="secondary" className="font-mono text-[11px]">{s.name}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">可用 Tools</div>
                    <div className="flex flex-wrap gap-1">
                      {preview.toolList.map((t: any) => (
                        <Badge key={t.id} variant="outline" className="font-mono text-[11px]">{t.name}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">System Prompt（含用户问题）</div>
                    <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-[400px] whitespace-pre-wrap leading-relaxed">
                      {preview.withQuestionPrompt || preview.basePrompt}
                    </pre>
                  </div>
                </div>
              )}
              {!preview && !previewing && (
                <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-lg">
                  <Zap className="w-5 h-5 mx-auto mb-1 opacity-50" />
                  点击「预览」查看 Planner 当前的执行空间
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!riskMandatory && riskOn && (
        <div className="fixed bottom-4 right-4 text-xs p-2 bg-destructive text-destructive-foreground rounded-md">
          注意：risk-check 被从必经 Skill 中移除，会导致规则破坏
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono ${tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : ""}`}>
        {String(value)}
      </div>
    </div>
  );
}
