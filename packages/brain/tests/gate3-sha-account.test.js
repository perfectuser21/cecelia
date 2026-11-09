/** SHA 回读回归入口：保留现役 BEHAVIOR-03/04/07，执行同仓真实部署脚本。 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..'); // tests/ → brain/ → packages/ → repo root
const SCRIPT = path.join(ROOT, 'tests/regression/gate3-sha-truth/sha-account.test.sh');

it('sha-account shell tests pass (BEHAVIOR-03/04/07)', () => {
  let exitCode = 0;
  try {
    execFileSync('bash', [SCRIPT], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 60_000,
      // 全套测试不得把本机正在运行的 Brain 当成 fixture，更不得 POST 真实 /deploy。
      // 指向确定性的不可达端口，shell 合同会走同一源码验证分支。
      env: { ...process.env, BRAIN_URL: 'http://127.0.0.1:1' },
    });
  } catch (err) {
    exitCode = err.status ?? 1;
  }
  expect(exitCode).toBe(0);
}, 90_000);
