/**
 * Skill Prompt 版本快照
 * 每个 Skill 保存最近 30 条版本，独立于 data/skills.json，只存 SKILL.md body。
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readSkillFile, writeSkillFile } from "./skills-registry";

const VERSIONS_FILE = path.join(process.cwd(), "data", "skill-versions.json");

export type SkillVersionSource = "manual" | "patch" | "rollback";

export interface SkillVersion {
  id: string;
  skillId: string;
  body: string;
  message: string;
  createdAt: string;
  source: SkillVersionSource;
}

interface VersionsStore {
  bySkillId: Record<string, SkillVersion[]>;
}

async function loadVersions(): Promise<VersionsStore> {
  try {
    const raw = await fs.readFile(VERSIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { bySkillId: {} };
  }
}

async function saveVersions(store: VersionsStore) {
  await fs.writeFile(VERSIONS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/** 写入 SKILL.md 前自动存一份快照（与最近一条完全一致会被去重） */
export async function snapshotSkillBeforeWrite(
  skillId: string,
  message: string,
  source: SkillVersionSource = "manual",
): Promise<SkillVersion | null> {
  const current = readSkillFile(skillId);
  if (current == null) return null;
  const store = await loadVersions();
  const list = store.bySkillId[skillId] || [];
  if (list.length > 0 && list[0].body === current) return list[0];
  const snap: SkillVersion = {
    id: "v_" + randomUUID().slice(0, 10),
    skillId,
    body: current,
    message,
    createdAt: new Date().toISOString(),
    source,
  };
  list.unshift(snap);
  store.bySkillId[skillId] = list.slice(0, 30);
  await saveVersions(store);
  return snap;
}

export async function listSkillVersions(skillId: string) {
  const store = await loadVersions();
  return store.bySkillId[skillId] || [];
}

export async function getSkillVersion(skillId: string, versionId: string) {
  const list = await listSkillVersions(skillId);
  return list.find((v) => v.id === versionId) || null;
}

/** 回滚到某版本，回滚前会自动为当前版本存一个 'rollback' 来源快照 */
export async function rollbackSkillVersion(skillId: string, versionId: string) {
  const target = await getSkillVersion(skillId, versionId);
  if (!target) throw new Error("版本不存在");
  await snapshotSkillBeforeWrite(skillId, `回滚到 ${versionId}`, "rollback");
  writeSkillFile(skillId, target.body);
  return (await listSkillVersions(skillId)).map((v) => ({
    vId: v.id,
    id: v.id,
    skillId: v.skillId,
    message: v.message,
    reason: v.message,
    createdAt: v.createdAt,
    source: v.source,
  }));
}
