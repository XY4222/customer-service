import { spawn } from "node:child_process";
import path from "node:path";

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", "5000"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    // 默认使用可复现的课堂模式；需要真实模型时显式传入 LLM_PROVIDER。
    LLM_PROVIDER: process.env.LLM_PROVIDER || "classroom-fixture",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
