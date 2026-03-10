/**
 * Cortex 反思去重状态持久化测试
 *
 * 验证 _reflectionState 持久化到 working_memory 表，
 * 进程重启后能恢复去重状态。
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
let pool;
let _resetReflectionState, _checkReflectionBreaker, _computeEventHash;

beforeAll(async () => {
  await vi.isolateModules(async () => {
    pool = (await import('../db.js')).default;
    ({ _resetReflectionState, _checkReflectionBreaker, _computeEventHash } = await import('../cortex.js'));
  });
});

const DB_KEY_PREFIX = 'cortex_reflection:';

describe('Cortex Dedup Persistence', () => {
  beforeEach(async () => {
    _resetReflectionState();
    await pool.query("DELETE FROM working_memory WHERE key LIKE 'cortex_reflection:%'");
  });

  afterEach(async () => {
    _resetReflectionState();
    await pool.query("DELETE FROM working_memory WHERE key LIKE 'cortex_reflection:%'");
  });

  describe('_computeEventHash', () => {
    it('generates consistent hash for same input', () => {
      const event = {
        type: 'rca_request',
        failure_history: [{ failure_classification: { class: 'NETWORK' } }],
        failed_task: { task_type: 'dev' },
      };
      const hash1 = _computeEventHash(event);
      const hash2 = _computeEventHash(event);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it('generates different hash for different input', () => {
      const event1 = { type: 'rca_request', failed_task: { task_type: 'dev' } };
      const event2 = { type: 'rca_request', failed_task: { task_type: 'review' } };
      expect(_computeEventHash(event1)).not.toBe(_computeEventHash(event2));
    });
  });

  describe('_checkReflectionBreaker with persistence', () => {
    it('DoD-1: restores state from DB on first call', async () => {
      const hash = 'test_hash_001';
      const now = Date.now();

      // 预先写入 DB 状态（模拟上次进程的状态）
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2::jsonb, NOW())
      `, [`${DB_KEY_PREFIX}${hash}`, JSON.stringify({
        count: 3, firstSeen: now - 60000, lastSeen: now - 30000
      })]);

      // 首次调用应从 DB 加载，count 已经是 3，+1=4 > 3 → 熔断
      const result = await _checkReflectionBreaker(hash);
      expect(result.open).toBe(true);
      expect(result.count).toBe(4);
    });

    it('DoD-2: persists state to DB after update', async () => {
      const hash = 'test_hash_002';

      // 调用一次（persist 现在是 await，无需额外等待）
      await _checkReflectionBreaker(hash);

      // 检查 DB
      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [`${DB_KEY_PREFIX}${hash}`]
      );
      expect(result.rows.length).toBe(1);

      const saved = result.rows[0].value_json;
      expect(saved.count).toBe(1);
    });

    it('DoD-3: expired entries are cleaned up on load', async () => {
      const freshHash = 'test_fresh';
      const expiredHash = 'test_expired';
      const now = Date.now();

      // 写入：一条未过期，一条已过期（35 分钟前）
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2::jsonb, NOW()), ($3, $4::jsonb, NOW())
      `, [
        `${DB_KEY_PREFIX}${freshHash}`,
        JSON.stringify({ count: 2, firstSeen: now - 60000, lastSeen: now - 30000 }),
        `${DB_KEY_PREFIX}${expiredHash}`,
        JSON.stringify({ count: 5, firstSeen: now - 35 * 60 * 1000, lastSeen: now - 31 * 60 * 1000 }),
      ]);

      // 调用时加载 → 过期条目被清理（persist 现在是 await，无需额外等待）
      const freshResult = await _checkReflectionBreaker(freshHash);
      expect(freshResult.count).toBe(3); // 2 + 1

      // 验证过期条目已从 DB 删除
      const expiredInDB = await pool.query(
        'SELECT key FROM working_memory WHERE key = $1',
        [`${DB_KEY_PREFIX}${expiredHash}`]
      );
      expect(expiredInDB.rows.length).toBe(0);
    });

    it('DoD-4: DB failure degrades to memory-only mode', async () => {
      // 写入无效结构到 DB（缺少 count 字段）
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2::jsonb, NOW())
      `, [`${DB_KEY_PREFIX}bad_data`, JSON.stringify({ bad_format: true })]);

      // 即使 DB 数据格式异常，也不应抛出异常
      const result = await _checkReflectionBreaker('test_fallback');
      expect(result.open).toBe(false);
      expect(result.count).toBe(1);
    });

    it('accumulates count correctly across multiple calls', async () => {
      const hash = 'test_accumulate';

      const r1 = await _checkReflectionBreaker(hash);
      expect(r1).toEqual({ open: false, count: 1 });

      // 第 2 次达到阈值 2 → 熔断（REFLECTION_BREAK_THRESHOLD = 2）
      const r2 = await _checkReflectionBreaker(hash);
      expect(r2).toEqual({ open: true, count: 2 });

      const r3 = await _checkReflectionBreaker(hash);
      expect(r3).toEqual({ open: true, count: 3 });
    });

    it('state survives simulated restart', async () => {
      const hash = 'test_restart';

      // 模拟进程 1：连续调用 3 次（persist 现在是 await，无需额外等待）
      await _checkReflectionBreaker(hash);
      await _checkReflectionBreaker(hash);
      await _checkReflectionBreaker(hash);

      // 模拟进程重启：清空内存
      _resetReflectionState();

      // 模拟进程 2：从 DB 恢复，第 4 次应熔断
      const result = await _checkReflectionBreaker(hash);
      expect(result.open).toBe(true);
      expect(result.count).toBe(4);
    });
  });
});
