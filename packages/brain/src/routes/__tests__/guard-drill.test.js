import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
  resolve(process.cwd(), 'packages/brain/src/routes/guard-drill.js'),
  'utf8'
);

describe('routes/guard-drill.js — 路由结构检查', () => {
  it('导出 default Router', () => {
    expect(src).toContain('export default router');
  });

  it('GET /status 路由存在', () => {
    expect(src).toContain("router.get('/status'");
  });

  it('POST /trigger 路由存在', () => {
    expect(src).toContain("router.post('/trigger'");
  });

  it('status 响应遍历 GUARD_REGISTRY 组装 guards 数组', () => {
    expect(src).toContain('guards');
    expect(src).toContain('GUARD_REGISTRY.map');
  });

  it('stale 判定基于 STALE_DAYS 常量', () => {
    expect(src).toContain('STALE_DAYS');
    expect(src).toContain('stale:');
  });

  it('trigger 路由调用 runGuardDrill + 先 reset gate', () => {
    expect(src).toContain('runGuardDrill');
    expect(src).toContain('__resetGuardDrillForTest');
  });

  it('days_since_verified 字段正确处理从未验火（Infinity → null）', () => {
    expect(src).toContain('days === Infinity ? null');
  });

  it('stale_threshold_days 在响应中暴露（前端标红依据）', () => {
    expect(src).toContain('stale_threshold_days');
  });
});
