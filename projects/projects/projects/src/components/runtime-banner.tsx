"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type FallbackInfo = {
  requested: string | null;
  actual: string;
  reason: string | null;
  degraded: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  coze: "扣子豆包",
  "openai-compatible": "OpenAI 兼容模型",
  "classroom-fixture": "演示稳定模式",
};

export function RuntimeBanner() {
  const [fallback, setFallback] = useState<FallbackInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let aborted = false;
    fetch("/api/runtime", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (aborted || !d) return;
        const fb = d.fallback as FallbackInfo | null;
        if (fb && fb.degraded) setFallback(fb);
      })
      .catch(() => { /* ignore */ });
    return () => {
      aborted = true;
    };
  }, []);

  if (!fallback || !fallback.degraded || dismissed) return null;

  const requestedLabel = fallback.requested
    ? (PROVIDER_LABEL[fallback.requested] || fallback.requested)
    : "目标模型";

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 text-amber-900">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-2 flex items-start gap-2 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <div className="flex-1 leading-relaxed">
          <b>当前自动运行在演示稳定模式。</b>
          你选择的 <b>{requestedLabel}</b> 未能就绪
          {fallback.reason ? <>（{fallback.reason}）</> : null}
          ，系统已自动降级到不依赖外部凭证的演示模式，页面与流程可正常浏览，但不会真实调用大模型。
          若需使用真实模型，请在部署平台的环境变量中配置对应密钥（如{" "}
          <code className="px-1 py-0.5 bg-amber-100 rounded text-xs">OPENAI_API_KEY</code>
          ）后重启服务，或前往
          <Link href="/models" className="underline underline-offset-2 mx-0.5">模型管理</Link>
          切换为可用的 Provider。
        </div>
        <button
          className="p-1 rounded hover:bg-amber-100 text-amber-700"
          onClick={() => setDismissed(true)}
          aria-label="关闭提示"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
