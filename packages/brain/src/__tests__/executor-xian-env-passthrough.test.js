import { describe, it, expect } from 'vitest';

// Regression test [MAJOR #4]: HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 已是死代码。
// harness 路由收编进 resolveExecutor（DB 驱动的 machine+executor），harness-task.graph.js
// 不再读这两个全局开关。executor.js 也不应再把它们透传进 initiative Docker 容器的 dockerEnv，
// 否则就是误导后人"还有西安全局开关"。本测试锁死：executor.js 源码不得再出现这两个变量的透传。
describe('executor.js 不再透传 HARNESS_XIAN 死开关到 dockerEnv', () => {
  it('源码不含 HARNESS_XIAN_ENABLED dockerEnv 透传', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(import.meta.dirname, '../executor.js'), 'utf8');
    expect(src).not.toMatch(/dockerEnv\.HARNESS_XIAN_ENABLED/);
    expect(src).not.toMatch(/dockerEnv\.HARNESS_XIAN_BRIDGE_URL/);
  });

  it('源码完全不引用 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(import.meta.dirname, '../executor.js'), 'utf8');
    expect(src).not.toMatch(/HARNESS_XIAN_ENABLED/);
    expect(src).not.toMatch(/HARNESS_XIAN_BRIDGE_URL/);
  });
});
