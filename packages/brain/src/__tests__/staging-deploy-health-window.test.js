/**
 * 守卫：staging-deploy.sh 健康检查窗口必须 >= 180s（MAX_TRIES × sleep）。
 * staging brain 启动 >60s，窗口退回 60s 会误判 deploy_failed 阻断 promote。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-deploy.sh');

describe('staging-deploy.sh 健康检查窗口', () => {
  const src = readFileSync(SCRIPT, 'utf8');

  it('健康检查总窗口 >= 180s（MAX_TRIES × sleep）', () => {
    const maxTries = Number((src.match(/MAX_TRIES=(\d+)/) || [])[1]);
    // 健康检查循环里的 sleep 秒数（取循环体内第一个 sleep N）
    const sleepSec = Number((src.match(/while \[ \$TRIES -lt \$MAX_TRIES \][\s\S]{0,120}?sleep (\d+)/) || [])[1]);
    expect(maxTries).toBeGreaterThanOrEqual(36);
    expect(maxTries * sleepSec).toBeGreaterThanOrEqual(180);
  });
});
