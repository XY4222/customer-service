/**
 * Skill registry - reads SKILL.md from skills/<id>/SKILL.md
 * Each SKILL.md has YAML frontmatter (--- ... ---) with metadata,
 * followed by markdown body (prompt).
 */
import fs from "fs";
import path from "path";
import { atomicWriteTextSync } from "./fs-atomic";

export interface SkillManifest {
  id: string;
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  requiredTools: string[];
  description?: string;
  body: string;
}

const DEFAULT_SKILL_FIELDS: Partial<SkillManifest> = {
  model: "doubao-seed-2-0-mini-260215",
  temperature: 0.3,
  maxTokens: 800,
  enabled: true,
};

const SKILLS_ROOT = path.join(process.cwd(), "skills");

function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const data: Record<string, any> = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val: any = m[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
    else val = val.replace(/^["']|["']$/g, "");
    data[key] = val;
  }
  return { data, body };
}

export function listSkills(): SkillManifest[] {
  if (!fs.existsSync(SKILLS_ROOT)) return [];
  const dirs = fs.readdirSync(SKILLS_ROOT).filter((d) => {
    const p = path.join(SKILLS_ROOT, d);
    return fs.statSync(p).isDirectory();
  });
  const results: SkillManifest[] = [];
  for (const id of dirs) {
    const skillPath = path.join(SKILLS_ROOT, id, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf-8");
    const { data, body } = parseFrontmatter(raw);
    // Extract description from first heading line after frontmatter
    let description = data.description || "";
    if (!description) {
      const firstLine = body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#"));
      description = firstLine ? firstLine.slice(0, 80) : "";
    }
    results.push({
      ...DEFAULT_SKILL_FIELDS,
      ...data,
      id: data.id || id,
      body: body.trim(),
      description,
    } as SkillManifest);
  }
  return results;
}

export function getSkill(id: string): SkillManifest | null {
  return listSkills().find((s) => s.id === id) || null;
}

/** Read a SKILL.md file content (for editor) */
export function readSkillFile(id: string): string | null {
  const p = path.join(SKILLS_ROOT, id, "SKILL.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

/** Write SKILL.md content (from editor) */
export function writeSkillFile(id: string, content: string) {
  const dir = path.join(SKILLS_ROOT, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteTextSync(path.join(dir, "SKILL.md"), content);
}

/** Create a new skill folder + SKILL.md skeleton */
export function createSkill(id: string, meta: {
  name: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  description?: string;
  enabled?: boolean;
  body?: string;
}) {
  const existing = getSkill(id);
  if (existing) throw new Error(`Skill ${id} already exists`);
  const body = meta.body || `# ${meta.name}\n\n${meta.description || "请填写该 Skill 的 Prompt 说明。"}`;
  const enabled = meta.enabled ?? true;
  const fm = [
    "---",
    `id: ${id}`,
    `name: ${meta.name}`,
    `model: ${meta.model || DEFAULT_SKILL_FIELDS.model}`,
    `temperature: ${meta.temperature ?? DEFAULT_SKILL_FIELDS.temperature}`,
    `maxTokens: ${meta.maxTokens ?? DEFAULT_SKILL_FIELDS.maxTokens}`,
    `enabled: ${enabled}`,
    "requiredTools: []",
    "---",
    "",
    body,
  ].join("\n");
  writeSkillFile(id, fm);
  return getSkill(id);
}

/** Toggle enabled state */
export function setSkillEnabled(id: string, enabled: boolean) {
  const content = readSkillFile(id);
  if (!content) return null;
  const { data, body } = parseFrontmatter(content);
  data.enabled = enabled;
  const fm = Object.entries(data)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      return `${k}: ${typeof v === "string" ? v : String(v)}`;
    })
    .join("\n");
  writeSkillFile(id, `---\n${fm}\n---\n\n${body}`);
  return getSkill(id);
}

/** AI create skill from natural language description */
export async function createSkillFromDescription(description: string, nameHint?: string) {
  const { callLLM } = await import("./llm");
  const sys = `你是一个 Agent Skill 设计专家。根据用户给出的能力描述，输出一份标准 SKILL.md 文档（Markdown），结构：
# 标题（Skill 名称）
一句话说明 Skill 作用。
## 输入
列出输入字段。
## 输出 JSON
给出严格 JSON schema 和示例。
## 规则
列出 3~8 条执行规则，具体、可执行、避免套话。
注意：只输出 Markdown 正文，不要包含 yaml frontmatter（---块）。`;
  const body = await callLLM({
    systemPrompt: sys,
    userPrompt: description,
    model: "doubao-seed-2-0-lite-260215",
    temperature: 0.4,
    maxTokens: 1500,
  });
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const name = titleMatch?.[1]?.trim() || nameHint || "新 Skill";
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `skill-${Date.now().toString(36)}`;
  // AI 草案默认 disabled + 标记 aiDraft，需人工确认后启用
  return createSkill(id, {
    name,
    body: body.startsWith("#") ? body : `# ${name}\n\n${body}`,
    enabled: false,
    description: "[AI 草案] " + (description || "").slice(0, 80),
  });
}

/** List only enabled skills (convenience for planner/executor) */
export function listEnabledSkills(): SkillManifest[] {
  return listSkills().filter((s) => s.enabled);
}

/** Update an existing skill (full save of SKILL.md content or patch fields) */
export function updateSkill(id: string, patch: {
  name?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  description?: string;
  enabled?: boolean;
  body?: string;
  requiredTools?: string[];
}) {
  const existing = getSkill(id);
  if (!existing) throw new Error(`Skill ${id} not found`);
  const originalContent = readSkillFile(id);
  const { data, body: originalBody } = originalContent
    ? parseFrontmatter(originalContent)
    : { data: {} as Record<string, unknown>, body: "" };
  const { body: _body, ...metadataPatch } = patch;
  const merged = { ...data, ...metadataPatch } as Record<string, unknown>;
  if (patch.requiredTools) merged.requiredTools = patch.requiredTools;
  const body = patch.body ?? originalBody;
  const fm = Object.entries(merged)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      if (typeof v === "string") return `${k}: ${v}`;
      return `${k}: ${String(v)}`;
    })
    .join("\n");
  writeSkillFile(id, `---\n${fm}\n---\n\n${body}`);
  return getSkill(id);
}

/** Alias: saveSkill = updateSkill */
export const saveSkill = updateSkill;

/** Delete a skill folder */
export function deleteSkill(id: string) {
  const dir = path.join(SKILLS_ROOT, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
