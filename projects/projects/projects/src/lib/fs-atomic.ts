import { randomUUID } from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";

/**
 * 原子写文件：先写临时文件再 rename，避免并发写同一文件时产生
 * 交错内容（JSON 拼接损坏）。所有运行时持久化写入都必须走这里。
 */
export async function atomicWriteText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, file);
}

/** 同步版本，用于同步代码路径（写入内容必须一次性构造完成）。 */
export function atomicWriteTextSync(file: string, content: string): void {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  fsSync.writeFileSync(tmp, content, "utf-8");
  fsSync.renameSync(tmp, file);
}
