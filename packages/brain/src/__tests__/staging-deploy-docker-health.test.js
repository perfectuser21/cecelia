/**
 * 守卫：staging-deploy.sh 健康检查必须用 docker inspect 容器 health（容器自己的 healthcheck），
 * 不能用 curl localhost:5222——staging-e2e-runner 在生产 brain 容器内跑，容器内 localhost 不通 staging 容器。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-deploy.sh');

describe('staging-deploy.sh 健康检查方式', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  // 只取健康检查段（[5/6] 到 staging 验证之间）
  const seg = (src.match(/\[5\/6\][\s\S]*?健康检查超时[\s\S]*?exit 1/) || [''])[0];

  it('健康检查用 docker inspect 容器 health', () => {
    expect(seg).toMatch(/docker inspect/);
    expect(seg).toMatch(/State\.Health/);
  });

  it('健康检查不再用 curl localhost 判定（容器内不通）', () => {
    expect(seg).not.toMatch(/curl[^\n]*localhost:\$\{STAGING_PORT\}[^\n]*tick\/status/);
  });
});
