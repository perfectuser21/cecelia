import { describe, expect, it } from 'vitest';
import { queueLaneSql } from '../task-queue-lanes.js';

describe('task queue lanes', () => {
  it('生成互斥的有头与待派发队列分类SQL，不拼接空类型枚举', () => {
    const sql = queueLaneSql('candidate');
    expect(sql).toContain("candidate.status NOT IN ('queued','pending')");
    expect(sql).toContain("candidate.payload->>'headed_manual'");
    expect(sql).toContain("THEN 'ide'");
    expect(sql).toContain("ELSE 'ready'");
    expect(sql).not.toMatch(/\bIN\s*\(\s*\)/);
  });
});
