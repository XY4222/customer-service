import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import path from 'path';
import fs from 'fs';
import { loadAndApplyConfigFromDisk } from './lib/llm';

// 加载 .env.local：dev 下 Next.js 会自动读，但 bootstrap 主进程（tsx watch）先于 Next worker 跑，需要手动加载；
// prod 下 Next.js standalone server 也不会自动读 .env.local，需要手动加载。
// dotenv.config({ override:false })：平台环境变量（process.env 已注入）优先级高于 .env.local。
try {
  const dotenv = require('dotenv');
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) {
      const r = dotenv.config({ path: p, override: false });
      if (!r.error) console.log(`[env] loaded ${f}`);
    }
  }
} catch (e) {
  console.warn('[env] dotenv not available, relying on process.env');
}
const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function bootstrap() {
  // 启动时把 data/llm-config.json 的 activeProvider 同步到 process.env。
  // 关键：
  //   - 用 process.env 共享（覆盖 Next.js dev 模式 worker 进程的模块隔离）
  //   - 仅当 LLM_PROVIDER 未显式设置时写（保留部署平台 env 优先级）
  //   - 失败不抛，退回 env
  const r = await loadAndApplyConfigFromDisk();
  if (r.applied) {
    if (r.degraded) {
      console.warn(`[llm-config] ⚠️  请求 provider=${r.requestedProvider} 但未就绪：${r.reason}`);
      console.warn(`[llm-config] 已自动降级到演示稳定模式（classroom-fixture），页面可正常打开，但不会调真实模型。`);
      console.warn(`[llm-config] 若需使用真实模型，请在部署环境配置对应环境变量（如 OPENAI_API_KEY）后重启。`);
    } else {
      console.log(`[llm-config] 已从 ${r.configPath} 应用 activeProvider=${r.provider}, model=${r.model ?? '(未指定)'}`);
    }
  } else if (r.reason) {
    console.log(`[llm-config] 未应用配置：${r.reason}；回退到 process.env.LLM_PROVIDER=${process.env.LLM_PROVIDER || '(未设)'}`);
  }

  await app.prepare();
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
}

bootstrap();
