"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Brain, RefreshCw, Trash2 } from "lucide-react";
import { FACT_KIND_LABELS, type MemoryKind } from "@/lib/memory-view";

interface MemoryFact {
  kind: MemoryKind;
  content: string;
  updatedAt: string;
  sourceRunId?: string;
}

interface ProfileSummary {
  visitorId: string;
  interactionCount: number;
  isNewUser: boolean;
  factCount: number;
  episodeCount: number;
  updatedAt: string;
  facts: MemoryFact[];
  lastEpisode: string | null;
}

const FACT_KIND_FALLBACK = "其他";

export default function MemoryPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memory");
      const data = await res.json();
      setProfiles(data.profiles ?? []);
    } catch {
      toast.error("加载记忆列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (visitorId: string) => {
    if (!confirm(`确认删除访客 ${visitorId} 的全部记忆？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(visitorId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("已删除该访客记忆");
        void load();
      } else {
        toast.error("删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };

  const totalFacts = profiles.reduce((s, p) => s + p.factCount, 0);
  const oldUsers = profiles.filter((p) => !p.isNewUser).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            记忆管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            跨会话用户画像：AI 从每次交互中提取的口味偏好、忌口、身份与预算习惯
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1">
            演示画像为合成数据（scripts/seed-memory.ts 生成）；真实对话产生的画像来自前台运行时提取，
            敏感信息写入前已脱敏
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{profiles.length}</div>
            <div className="text-xs text-muted-foreground mt-1">有记忆的访客</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{totalFacts}</div>
            <div className="text-xs text-muted-foreground mt-1">累计稳定事实</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{oldUsers}</div>
            <div className="text-xs text-muted-foreground mt-1">老客（已购买/复购）</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">
              {profiles.reduce((s, p) => s + p.interactionCount, 0)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">累计记忆化交互</div>
          </CardContent>
        </Card>
      </div>

      {/* 画像列表 */}
      {loading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            加载中...
          </CardContent>
        </Card>
      ) : profiles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            暂无访客记忆。前台发起对话后，系统会自动从交互中提取用户画像。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => (
            <Card key={p.visitorId}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base font-mono">{p.visitorId}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      最近更新 {new Date(p.updatedAt).toLocaleString("zh-CN")}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={p.isNewUser ? "secondary" : "default"} className="font-normal">
                      {p.isNewUser ? "新客" : "老客"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(p.visitorId)}
                      title="删除该访客记忆"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-2">
                  交互 {p.interactionCount} 次 · {p.factCount} 条事实 · {p.episodeCount} 条轨迹
                </div>
                {p.facts.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {p.facts.map((f, i) => (
                      <span
                        key={`${p.visitorId}-f${i}`}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                      >
                        <span className="text-muted-foreground">
                          {FACT_KIND_LABELS[f.kind] ?? FACT_KIND_FALLBACK}
                        </span>
                        <span>{f.content}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">（暂无稳定事实）</div>
                )}
                {p.lastEpisode && (
                  <div className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
                    最近交互：{p.lastEpisode}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
