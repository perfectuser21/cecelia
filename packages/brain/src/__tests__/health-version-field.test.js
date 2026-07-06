import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

// Gate3 部署效果确认（2026-07-06 假成功修复）依赖 /health 暴露 version，
// 供 scripts/ci/assert-deploy-effect.sh 断言"跑的是预期版本"。
// 守护：/health 响应体必须含 version 字段（来自 package.json）。
describe('/health version field (Gate3 deploy-effect 前提)', () => {
  const SRC = readFileSync(new URL('../routes/goals.js', import.meta.url), 'utf8');

  it('/health handler 响应体暴露 version: pkg.version', () => {
    // 定位 GET /health handler 到下一个 router. 之间的片段
    const start = SRC.indexOf("router.get('/health'");
    expect(start).toBeGreaterThan(-1);
    const next = SRC.indexOf('router.', start + 20);
    const block = SRC.slice(start, next === -1 ? SRC.length : next);
    // 该 handler 的 res.json 必须包含 version 字段
    expect(block).toMatch(/version:\s*pkg\.version/);
  });
});
