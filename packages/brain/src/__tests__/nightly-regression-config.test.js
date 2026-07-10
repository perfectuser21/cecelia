/**
 * nightly-regression-config.test.js
 * 守住刀A：nightly 全量回归闸 workflow 必须存在且形态正确。
 * 背景：PR CI 按路径过滤 + vitest --changed，integration/** 被永久 exclude，
 * 全仓无任何 schedule 触发 → 回归只能靠 nightly 全量兜底。此测试防 workflow 被静默删改。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const WF = readFileSync(
  new URL('../../../../.github/workflows/nightly-full-regression.yml', import.meta.url), 'utf8'
);

describe('nightly-full-regression workflow', () => {
  it('有 schedule 定时触发（nightly）', () => {
    expect(WF).toMatch(/schedule:/);
    expect(WF).toMatch(/cron:/);
  });
  it('有 workflow_dispatch 手动触发 + fire_test 输入（proven-to-fire）', () => {
    expect(WF).toMatch(/workflow_dispatch:/);
    expect(WF).toMatch(/fire_test/);
  });
  it('跑 brain 全量测试且包含 integration/**（PR CI 从不跑这组）', () => {
    expect(WF).toMatch(/vitest run/);
    expect(WF).toMatch(/src\/__tests__\/integration/);
    expect(WF).not.toMatch(/--exclude='src\/__tests__\/integration/);
  });
  it('起真 Postgres service 并跑全量 migrations', () => {
    expect(WF).toMatch(/postgres/);
    expect(WF).toMatch(/migrate\.js/);
  });
  it('红时开 [nightly-red] Issue 且不阻塞 PR（无 pull_request 触发）', () => {
    expect(WF).toMatch(/nightly-red/);
    expect(WF).not.toMatch(/pull_request:/);
  });
});
