/**
 * LLM Provider 配置层（data/llm-config.json）
 *
 * 关键安全约束：
 *   - 永不接收、永不存储、永不返回明文 API Key
 *   - 前端只关心"哪个环境变量名"以及"该环境变量是否已设置"
 *   - 切换 provider 同时落盘到 data/llm-config.json（持久声明）
 *   - 运行时 provider 通过 src/lib/llm.ts 内的内存变量热切换（不需要重启 dev server）
 */

import { promises as fs } from "fs";
import path from "path";

export type LLMProviderId = "coze" | "openai-compatible" | "classroom-fixture";

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderConfig {
  enabled: boolean;
  label: string;
  description: string;
  defaultModel: string;
  models: ModelOption[];
  /** OpenAI 兼容协议时 baseURL 的环境变量名（仅名字，不存值） */
  baseUrlEnvName?: string;
  /** API Key 的环境变量名（仅名字，不存值） */
  apiKeyEnvName?: string;
  /** 提示用户填的默认 baseURL（仅展示用） */
  defaultBaseUrl?: string;
  /** 该 provider 是否需要 API Key 才能调用 */
  requiresApiKey?: boolean;
}

export interface LLMConfig {
  activeProvider: LLMProviderId;
  providers: Record<LLMProviderId, ProviderConfig>;
  updatedAt?: string;
}

export interface SecretStatus {
  /** 该 provider 用到的所有环境变量名 */
  envNames: string[];
  /** 每个环境变量是否已设置（true=已设置 / false=未设置） */
  configured: Record<string, boolean>;
  /** 该 provider 是否所有必需变量都已就绪（requiresApiKey 时检查 apiKeyEnvName） */
  ready: boolean;
  /** 缺什么，给页面展示 */
  missing: string[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = "llm-config.json";

/** 拒绝入库的字段名（防止误传明文密钥） */
const FORBIDDEN_KEYS = [
  "apiKey",
  "api_key",
  "apikey",
  "key",
  "secret",
  "token",
  "password",
  "authorization",
  "openaiApiKey",
  "openai_api_key",
];

function defaultConfig(): LLMConfig {
  return {
    activeProvider: "coze",
    providers: {
      "coze": {
        enabled: true,
        label: "扣子豆包 (Doubao)",
        description: "通过 coze-coding-dev-sdk 调用，需要沙箱凭证。",
        defaultModel: "doubao-seed-1-8-251228",
        models: [{ id: "doubao-seed-1-8-251228", label: "Doubao Seed 1.8" }],
      },
      "openai-compatible": {
        enabled: true,
        label: "OpenAI 兼容",
        description: "任何支持 /v1/chat/completions 的服务。",
        defaultModel: "doubao-seed-1-8-251228",
        models: [{ id: "doubao-seed-1-8-251228", label: "Doubao Seed 1.8 (沙箱内置)" }],
        baseUrlEnvName: "OPENAI_BASE_URL",
        apiKeyEnvName: "OPENAI_API_KEY",
        defaultBaseUrl: "https://api.openai.com/v1",
        requiresApiKey: true,
      },
      "classroom-fixture": {
        enabled: true,
        label: "演示稳定模式",
        description: "使用内置确定性输出，无需 API Key。",
        defaultModel: "fixture-v1",
        models: [{ id: "fixture-v1", label: "Fixture v1" }],
        requiresApiKey: false,
      },
    },
  };
}

function sanitizePatch(patch: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!patch || typeof patch !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.includes(k)) continue; // 丢弃任何明文 Key
    out[k] = v;
  }
  return out;
}

export async function readLLMConfig(): Promise<LLMConfig> {
  try {
    const p = path.join(DATA_DIR, CONFIG_FILE);
    const s = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(s) as LLMConfig;
    // 浅合并：磁盘缺字段时用默认
    const def = defaultConfig();
    return {
      activeProvider: parsed.activeProvider ?? def.activeProvider,
      providers: {
        "coze": { ...def.providers["coze"], ...(parsed.providers?.["coze"] ?? {}) },
        "openai-compatible": { ...def.providers["openai-compatible"], ...(parsed.providers?.["openai-compatible"] ?? {}) },
        "classroom-fixture": { ...def.providers["classroom-fixture"], ...(parsed.providers?.["classroom-fixture"] ?? {}) },
      },
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return defaultConfig();
  }
}

export async function writeLLMConfig(cfg: LLMConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, CONFIG_FILE);
  const tmp = path.join(DATA_DIR, `.${CONFIG_FILE}.tmp-${Date.now()}`);
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  await fs.rename(tmp, p);
}

export interface LLMConfigUpdate {
  activeProvider?: LLMProviderId;
  /** 每个 provider 的可调字段（defaultModel / enabled / models 等） */
  providers?: Partial<Record<LLMProviderId, Record<string, unknown>>>;
}

export async function updateLLMConfig(patch: LLMConfigUpdate): Promise<LLMConfig> {
  const cur = await readLLMConfig();

  if (patch.activeProvider) {
    if (!["coze", "openai-compatible", "classroom-fixture"].includes(patch.activeProvider)) {
      throw new Error(`不支持的 provider: ${patch.activeProvider}`);
    }
    cur.activeProvider = patch.activeProvider;
  }

  if (patch.providers) {
    for (const [id, raw] of Object.entries(patch.providers)) {
      if (!(id in cur.providers)) continue;
      const clean = sanitizePatch(raw);
      // 仅允许白名单字段
      const allow: (keyof ProviderConfig)[] = [
        "enabled", "label", "description", "defaultModel", "models",
        "baseUrlEnvName", "apiKeyEnvName", "defaultBaseUrl", "requiresApiKey",
      ];
      const safe: Record<string, unknown> = {};
      for (const k of allow) {
        if (k in clean) safe[k] = clean[k];
      }
      cur.providers[id as LLMProviderId] = { ...cur.providers[id as LLMProviderId], ...safe } as ProviderConfig;
    }
  }

  cur.updatedAt = new Date().toISOString();
  await writeLLMConfig(cur);
  return cur;
}

export function getSecretStatus(p: ProviderConfig): SecretStatus {
  const envNames: string[] = [];
  if (p.baseUrlEnvName) envNames.push(p.baseUrlEnvName);
  if (p.apiKeyEnvName) envNames.push(p.apiKeyEnvName);
  const configured: Record<string, boolean> = {};
  for (const n of envNames) configured[n] = Boolean(process.env[n] && process.env[n]!.length > 0);
  const missing: string[] = [];
  if (p.requiresApiKey && p.apiKeyEnvName && !configured[p.apiKeyEnvName]) missing.push(p.apiKeyEnvName);
  // baseURL 缺失不计入 missing（会回退到 defaultBaseUrl，仅在 UI 提示）
  return {
    envNames,
    configured,
    ready: missing.length === 0,
    missing,
  };
}
