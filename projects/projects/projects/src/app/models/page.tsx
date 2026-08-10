"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LLMProviderId = "coze" | "openai-compatible" | "classroom-fixture";
type ModelOption = { id: string; label: string };
type ProviderConfig = {
  enabled: boolean;
  label: string;
  description: string;
  defaultModel: string;
  models: ModelOption[];
  baseUrlEnvName?: string;
  apiKeyEnvName?: string;
  defaultBaseUrl?: string;
  requiresApiKey?: boolean;
};
type LLMConfig = {
  activeProvider: LLMProviderId;
  providers: Record<LLMProviderId, ProviderConfig>;
  updatedAt?: string;
};
type ProviderStatus = {
  provider: LLMProviderId;
  label: string;
  description: string;
  isFixture: boolean;
  model: string;
};
type SecretStatus = {
  envNames: string[];
  configured: Record<string, boolean>;
  ready: boolean;
  missing: string[];
};

const PROVIDER_META: Record<LLMProviderId, { title: string; hint: string }> = {
  "coze": {
    title: "扣子豆包（Doubao）",
    hint: "通过 coze-coding-dev-sdk 调用。沙箱内开箱即用，无需 API Key。",
  },
  "openai-compatible": {
    title: "OpenAI 兼容（DeepSeek / Kimi / GLM / 任意 /v1/chat/completions）",
    hint: "任何支持 Chat Completions 协议的服务。需要在环境变量中配置 API Key。",
  },
  "classroom-fixture": {
    title: "演示稳定模式",
    hint: "使用内置确定性输出，不依赖任何外部凭证。教学/演示专用。",
  },
};

export default function ModelsPage() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [runtime, setRuntime] = useState<ProviderStatus | null>(null);
  const [runtimeOverride, setRuntimeOverride] = useState<LLMProviderId | null>(null);
  const [secrets, setSecrets] = useState<Record<string, SecretStatus>>({});
  const [runtimeMatchesConfig, setRuntimeMatchesConfig] = useState(true);
  const [activeTab, setActiveTab] = useState<LLMProviderId>("coze");
  const [testBusy, setTestBusy] = useState<LLMProviderId | null>(null);
  const [switchBusy, setSwitchBusy] = useState<LLMProviderId | null>(null);

  // 临时编辑态（每个 provider 一份）
  const [editModels, setEditModels] = useState<Record<LLMProviderId, string>>({
    "coze": "",
    "openai-compatible": "",
    "classroom-fixture": "",
  });
  const [editEnabled, setEditEnabled] = useState<Record<LLMProviderId, boolean>>({
    "coze": true,
    "openai-compatible": true,
    "classroom-fixture": true,
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/llm-config", { cache: "no-store" });
    const d = await res.json();
    setConfig(d.config);
    setRuntime(d.runtime);
    setRuntimeOverride(d.runtimeOverride);
    setSecrets(d.secrets);
    setRuntimeMatchesConfig(d.runtimeMatchesConfig);
    if (d.config) {
      setActiveTab(d.config.activeProvider);
      setEditModels({
        "coze": d.config.providers["coze"].defaultModel,
        "openai-compatible": d.config.providers["openai-compatible"].defaultModel,
        "classroom-fixture": d.config.providers["classroom-fixture"].defaultModel,
      });
      setEditEnabled({
        "coze": d.config.providers["coze"].enabled,
        "openai-compatible": d.config.providers["openai-compatible"].enabled,
        "classroom-fixture": d.config.providers["classroom-fixture"].enabled,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const saveDefaultModel = async (id: LLMProviderId) => {
    if (!config) return;
    const newModel = editModels[id];
    const newEnabled = editEnabled[id];
    if (!newModel) {
      toast.error("默认模型不能为空");
      return;
    }
    const res = await fetch("/api/llm-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: {
          [id]: { defaultModel: newModel, enabled: newEnabled },
        },
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      toast.error(d.error || "保存失败");
      return;
    }
    toast.success(`已保存 ${PROVIDER_META[id].title} 的默认配置`);
    await load();
  };

  const testConnection = async (id: LLMProviderId) => {
    setTestBusy(id);
    try {
      const res = await fetch("/api/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, model: editModels[id] || undefined }),
      });
      const d = await res.json();
      if (d.ok) {
        toast.success(
          `✅ ${PROVIDER_META[id].title} 连通 (${d.latencyMs}ms)${d.preview ? " — " + d.preview : ""}`,
          { duration: 5000 }
        );
      } else {
        toast.error(`❌ 连通失败：${d.error}`);
      }
    } catch (e: any) {
      toast.error(`调用失败：${e?.message || String(e)}`);
    } finally {
      setTestBusy(null);
    }
  };

  const switchProvider = async (id: LLMProviderId) => {
    setSwitchBusy(id);
    try {
      const res = await fetch("/api/llm-config/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast.error(d.error || "切换失败");
        return;
      }
      toast.success(d.note || `已切换到 ${PROVIDER_META[id].title}`);
      await load();
    } catch (e: any) {
      toast.error(`切换失败：${e?.message || String(e)}`);
    } finally {
      setSwitchBusy(null);
    }
  };

  if (loading || !config || !runtime) {
    return (
      <main className="min-h-screen bg-amber-50/40 p-6">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm text-stone-500">加载中…</p>
        </div>
      </main>
    );
  }

  const order: LLMProviderId[] = ["coze", "openai-compatible", "classroom-fixture"];

  return (
    <main className="min-h-screen bg-amber-50/40 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-stone-800">模型管理</h1>
          <p className="mt-1 text-sm text-stone-500">
            管理 LLM Provider 接入。所有密钥仅以"环境变量名"形式登记，明文永不落盘、永不返回。
          </p>
        </header>

        {/* 运行状态卡 */}
        <Card className="border-amber-200 bg-white">
          <CardHeader>
            <CardTitle className="text-base">当前运行模式</CardTitle>
            <CardDescription>
              运行时由进程内变量决定（可通过下方按钮热切换），重启后回退到 <code>LLM_PROVIDER</code> 环境变量。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="bg-amber-100 text-amber-900">
              provider: {runtime.provider}
            </Badge>
            <Badge variant="outline">{runtime.label}</Badge>
            <Badge variant="outline">model: {runtime.model}</Badge>
            {runtime.isFixture ? (
              <Badge className="bg-purple-100 text-purple-800">Fixture / 非真实模型</Badge>
            ) : null}
            {runtimeOverride ? (
              <Badge className="bg-sky-100 text-sky-800">已热切换（覆写 env）</Badge>
            ) : null}
            {runtimeMatchesConfig ? (
              <Badge className="bg-emerald-100 text-emerald-800">与配置一致</Badge>
            ) : (
              <Badge className="bg-rose-100 text-rose-800">与配置不一致</Badge>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LLMProviderId)}>
          <TabsList>
            {order.map((id) => (
              <TabsTrigger key={id} value={id}>
                {PROVIDER_META[id].title.split("（")[0]}
              </TabsTrigger>
            ))}
          </TabsList>

          {order.map((id) => {
            const p = config.providers[id];
            const sec = secrets[id];
            const isActive = config.activeProvider === id;
            return (
              <TabsContent key={id} value={id}>
                <Card className="border-amber-200 bg-white">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{PROVIDER_META[id].title}</CardTitle>
                        <CardDescription className="mt-1">{p.description}</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-800">当前活动</Badge>
                        ) : null}
                        {!p.enabled ? (
                          <Badge variant="secondary" className="bg-stone-200 text-stone-700">已停用</Badge>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* 启用开关 */}
                    <div className="flex items-center justify-between rounded-md border border-amber-100 bg-amber-50/30 px-3 py-2">
                      <div>
                        <Label className="text-sm">启用该 Provider</Label>
                        <p className="text-xs text-stone-500">关闭后该 Provider 不出现在活动选项里。</p>
                      </div>
                      <Switch
                        checked={editEnabled[id]}
                        onCheckedChange={(v) => setEditEnabled((s) => ({ ...s, [id]: v }))}
                      />
                    </div>

                    {/* 默认模型 */}
                    <div className="space-y-2">
                      <Label className="text-sm">默认模型</Label>
                      <div className="flex gap-2">
                        <Select
                          value={editModels[id]}
                          onValueChange={(v) => setEditModels((s) => ({ ...s, [id]: v }))}
                        >
                          <SelectTrigger className="max-w-md">
                            <SelectValue placeholder="选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {p.models.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={editModels[id]}
                          onChange={(e) => setEditModels((s) => ({ ...s, [id]: e.target.value }))}
                          placeholder="或填入自定义模型 id"
                          className="max-w-xs"
                        />
                      </div>
                    </div>

                    {/* OpenAI 兼容特有：环境变量提示 */}
                    {id === "openai-compatible" ? (
                      <div className="space-y-3 rounded-md border border-amber-100 bg-amber-50/30 p-3">
                        <div>
                          <Label className="text-sm">API Key（仅环境变量名）</Label>
                          <p className="text-xs text-stone-500">
                            在部署平台的「环境变量」配置项中添加 <code>{p.apiKeyEnvName}</code>
                            （本地开发可写在项目根 <code>.env.local</code>）。本页面不会接收、不会存储明文。
                          </p>
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <code className="rounded bg-stone-100 px-2 py-1 text-xs">{p.apiKeyEnvName}</code>
                            {sec?.configured[p.apiKeyEnvName || ""] ? (
                              <Badge className="bg-emerald-100 text-emerald-800">已配置</Badge>
                            ) : (
                              <>
                                <Badge className="bg-rose-100 text-rose-800">未配置</Badge>
                                <span className="text-[11px] text-rose-700">
                                  未配置时无法调用；部署后若看到此标识，请在部署控制台添加该环境变量并重启服务。
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm">Base URL（仅环境变量名）</Label>
                          <p className="text-xs text-stone-500">
                            默认 <code>{p.defaultBaseUrl}</code>；DeepSeek 填 <code>https://api.deepseek.com/v1</code>，
                            Kimi 填 <code>https://api.moonshot.cn/v1</code>，可在环境变量 <code>{p.baseUrlEnvName}</code> 覆盖。
                          </p>
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <code className="rounded bg-stone-100 px-2 py-1 text-xs">{p.baseUrlEnvName}</code>
                            {sec?.configured[p.baseUrlEnvName || ""] ? (
                              <Badge className="bg-emerald-100 text-emerald-800">已配置</Badge>
                            ) : (
                              <>
                                <Badge variant="secondary">未配置（用默认）</Badge>
                                <span className="text-[11px] text-stone-500">
                                  留空将使用默认 OpenAI 地址；如需接 DeepSeek/Kimi 等，请配置该变量。
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* 演示模式说明 */}
                    {id === "classroom-fixture" ? (
                      <div className="rounded-md border border-purple-100 bg-purple-50/40 p-3 text-xs text-purple-900">
                        演示模式不调任何外部服务，仅用于演示与回路测试，不消耗 API 额度。
                      </div>
                    ) : null}

                    {/* 豆包说明 */}
                    {id === "coze" ? (
                      <div className="rounded-md border border-amber-100 bg-amber-50/30 p-3 text-xs text-amber-900">
                        仅在扣子沙箱/部署环境内开箱可用，由平台自动注入凭证；脱离平台后将无法调用，请改选 OpenAI 兼容模式并配置 API Key。
                      </div>
                    ) : null}

                    {/* 操作按钮 */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => saveDefaultModel(id)}
                      >
                        保存默认配置
                      </Button>
                      <Button
                        variant="outline"
                        disabled={testBusy === id}
                        onClick={() => testConnection(id)}
                      >
                        {testBusy === id ? "测试中…" : "测试连接"}
                      </Button>
                      <Button
                        disabled={switchBusy === id || isActive || !p.enabled}
                        onClick={() => switchProvider(id)}
                        className="bg-amber-600 text-white hover:bg-amber-700"
                      >
                        {switchBusy === id ? "切换中…" : isActive ? "当前活动" : "应用为活动 Provider"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>

        <Card className="border-amber-200 bg-white">
          <CardHeader>
            <CardTitle className="text-sm">安全说明</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-stone-600 space-y-1">
            <p>· 本页面只展示环境变量名与"已/未配置"徽标，<b>不会</b>接收、<b>不会</b>存储、<b>不会</b>返回任何明文密钥。</p>
            <p>· 所有 <code>apiKey</code> / <code>key</code> / <code>secret</code> / <code>token</code> / <code>password</code> 命名的字段会在入库前被丢弃，提交带明文的请求也会被 400 拒绝。</p>
            <p>· "应用为活动 Provider" 会同时落盘到 <code>data/llm-config.json</code> 并在当前进程中热切换。部署环境请在平台「环境变量」中配置对应密钥后再切换。</p>
            <p>· 若部署环境中选的 Provider 缺少凭证，系统会<b>自动降级到演示稳定模式</b>，保证页面可正常打开；顶部会出现黄色提示条说明原因。</p>
            <p>· 演示稳定模式是<b>唯一</b>不消耗真实 API 额度的选项，可作为零成本冒烟测试。</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
