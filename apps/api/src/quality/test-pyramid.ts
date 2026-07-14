/**
 * Quality API — 测试金字塔面板数据
 * GET /api/quality/test-pyramid
 *
 * 宿主进程 execFile `node scripts/test-pyramid-guard.mjs --json`（api 跑在宿主，
 * 有主仓文件访问权）。guard exit 1 时 stdout 仍是合法 JSON（pass:false 是合法
 * 数据不是 500，照常 200 返回）；execFile 真异常/超时/JSON parse 失败 →
 * 200 {available:false, error}（面板灰态数据，不 500）。
 *
 * 挂载：server.ts 中注册在 /api/quality proxy 之前，只占 /test-pyramid 一条
 * 路径，其余 /api/quality/* 继续走 quality proxy。
 */

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 仓库根：apps/api/src/quality（或 dist/quality，同深度）向上 4 层
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GUARD_TIMEOUT_MS = 5000;

const router = Router();

router.get('/test-pyramid', (_req: Request, res: Response) => {
  execFile(
    'node',
    ['scripts/test-pyramid-guard.mjs', '--json'],
    { cwd: REPO_ROOT, timeout: GUARD_TIMEOUT_MS },
    (error, stdout) => {
      const raw = typeof stdout === 'string' ? stdout : String(stdout ?? '');
      try {
        const data = JSON.parse(raw);
        if (data === null || typeof data !== 'object' || typeof data.pass !== 'boolean') {
          throw new Error('guard 输出缺少 pass 字段');
        }
        // guard exit 1（error 非空）但 stdout 是合法 JSON → pass:false 是合法数据
        return res.json({ available: true, ...data });
      } catch {
        const message = error instanceof Error ? error.message : 'guard 输出不是合法 JSON';
        return res.json({ available: false, error: message });
      }
    }
  );
});

export default router;
