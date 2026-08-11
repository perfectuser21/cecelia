import { describe, it, expect } from 'vitest';

// TDD Red: 路由未注册 → GET /failure-stats 返回 404，断言失败 → red
// 打运行中的 Brain（localhost:5221），autonomous 两层验证的模式 A（API-level）
const BASE = process.env.BRAIN_URL || 'http://localhost:5221';

describe('GET /api/brain/harness/failure-stats [BEHAVIOR]', () => {
  it('failure-stats days=7 返回 failure_rate number 与 by_class object', async () => {
    const res = await fetch(`${BASE}/api/brain/harness/failure-stats?days=7`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(typeof j.failure_rate).toBe('number');
    expect(typeof j.by_class).toBe('object');
    expect(j).toHaveProperty('total_tasks');
    expect(j).toHaveProperty('terminal_failed_count');
    expect(j).not.toHaveProperty('period_days');
  });

  it('failure-stats 非法 days 返回 400 error', async () => {
    const res = await fetch(`${BASE}/api/brain/harness/failure-stats?days=abc`);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(typeof j.error).toBe('string');
  });
});
