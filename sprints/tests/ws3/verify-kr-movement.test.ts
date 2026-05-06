/**
 * Workstream 3 — F2 评估好坏（verifyKRMovement 三态）BEHAVIOR 测试
 *
 * 目标函数: verifyKRMovement(taskId)
 * 实现位置: packages/brain/src/kr-verifier.js
 *
 * 红阶段：函数未导出 → import 失败；行为不符 → 三态断言全红
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

describe('Workstream 3 — verifyKRMovement [BEHAVIOR]', () => {
  let krVerifier: any;
  let pool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../../packages/brain/src/db.js')).default;
    krVerifier = await import('../../../packages/brain/src/kr-verifier.js');
  });

  it('exports verifyKRMovement from kr-verifier.js', () => {
    expect(krVerifier.verifyKRMovement).toBeDefined();
    expect(typeof krVerifier.verifyKRMovement).toBe('function');
  });

  it('after > before → moved=true（before=50, after=51 → moved=true）', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/task/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 't-1', kr_id: 'kr-a', kr_progress_before: 50 }],
        });
      }
      if (/key_results/i.test(sql) || /SELECT.*progress/i.test(sql)) {
        return Promise.resolve({ rows: [{ progress: 51 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await krVerifier.verifyKRMovement('t-1');
    expect(result).toBeDefined();
    expect(result.kr_id).toBe('kr-a');
    expect(result.before).toBe(50);
    expect(result.after).toBe(51);
    expect(result.moved).toBe(true);
  });

  it('after === before → moved=false（before=50, after=50 → moved=false）', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/task/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 't-2', kr_id: 'kr-b', kr_progress_before: 50 }],
        });
      }
      if (/key_results/i.test(sql) || /SELECT.*progress/i.test(sql)) {
        return Promise.resolve({ rows: [{ progress: 50 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await krVerifier.verifyKRMovement('t-2');
    expect(result.before).toBe(50);
    expect(result.after).toBe(50);
    expect(result.moved).toBe(false);
  });

  it('task 无 kr_id → moved=null, before=null, after=null', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/task/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 't-3', kr_id: null, kr_progress_before: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await krVerifier.verifyKRMovement('t-3');
    expect(result.kr_id).toBeNull();
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
    expect(result.moved).toBeNull();
  });

  it('返回对象 keys 严格为 [kr_id, before, after, moved] 四个，无多余字段', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/task/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 't-4', kr_id: 'kr-c', kr_progress_before: 10 }],
        });
      }
      if (/key_results/i.test(sql) || /SELECT.*progress/i.test(sql)) {
        return Promise.resolve({ rows: [{ progress: 11 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await krVerifier.verifyKRMovement('t-4');
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['after', 'before', 'kr_id', 'moved']);
  });

  it('before 与 after 在有 kr_id 时类型均为 number', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/task/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 't-5', kr_id: 'kr-d', kr_progress_before: 0 }],
        });
      }
      if (/key_results/i.test(sql) || /SELECT.*progress/i.test(sql)) {
        return Promise.resolve({ rows: [{ progress: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await krVerifier.verifyKRMovement('t-5');
    expect(typeof result.before).toBe('number');
    expect(typeof result.after).toBe('number');
  });
});
