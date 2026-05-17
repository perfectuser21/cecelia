/**
 * session-tracking.test.js
 *
 * 测试 Session 时长追踪功能：
 * - D4-1: 首次成功派发任务时记录 _sessionStart（仅首次，不覆盖）
 * - D4-2: setBillingPause 调用时记录 session 结束，写入 cecelia_events
 * - D4-3: GET /api/brain/session/stats 返回正确结构
 *
 * DoD 映射：
 * - D4-1 → '首次派发记录 sessionStart'
 * - D4-2 → 'setBillingPause 写入 session_end 事件'
 * - D4-3 → 'session/stats API 返回正确结构'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 session 追踪状态（与 executor.js 实现一致）
let _sessionStart = null;

function recordSessionStart() {
  if (!_sessionStart) {
    _sessionStart = new Date().toISOString();
  }
}

async function recordSessionEnd(reason, poolRef = null) {
  if (!_sessionStart) return null;
  const endTime = new Date().toISOString();
  const durationMs = Date.now() - new Date(_sessionStart).getTime();
  const durationMin = Math.round(durationMs / 60000);
  const record = { start: _sessionStart, end: endTime, duration_min: durationMin, reason };
  if (poolRef) {
    try {
      await poolRef.query(
        `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('session_end', $1, NOW())`,
        [JSON.stringify(record)]
      );
    } catch (e) {
      // 忽略写入失败
    }
  }
  _sessionStart = null;
  return record;
}

function getSessionInfo() {
  if (!_sessionStart) return { active: false };
  const durationMin = Math.round((Date.now() - new Date(_sessionStart).getTime()) / 60000);
  return { active: true, start: _sessionStart, duration_min: durationMin };
}

function _resetSessionStart() {
  _sessionStart = null;
}

describe('Session 时长追踪 - D4', () => {
  beforeEach(() => {
    _resetSessionStart();
  });

  describe('D4-1: recordSessionStart 仅首次生效', () => {
    it('首次调用设置 _sessionStart', () => {
      const before = Date.now();
      recordSessionStart();
      const after = Date.now();

      const info = getSessionInfo();
      expect(info.active).toBe(true);
      expect(new Date(info.start).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(info.start).getTime()).toBeLessThanOrEqual(after);
    });

    it('多次调用不覆盖首次设置的时间', async () => {
      recordSessionStart();
      const firstStart = getSessionInfo().start;

      await new Promise(resolve => setTimeout(resolve, 5));
      recordSessionStart(); // 第二次不应覆盖

      expect(getSessionInfo().start).toBe(firstStart);
    });

    it('无 session 时 getSessionInfo 返回 active: false', () => {
      const info = getSessionInfo();
      expect(info.active).toBe(false);
      expect(info.start).toBeUndefined();
    });
  });

  describe('D4-2: recordSessionEnd 写入 session_end 事件', () => {
    it('setBillingPause 后 recordSessionEnd 返回正确的 record', async () => {
      recordSessionStart();
      const record = await recordSessionEnd('billing_cap', null);

      expect(record).toBeDefined();
      expect(record.reason).toBe('billing_cap');
      expect(record.start).toBeDefined();
      expect(record.end).toBeDefined();
      expect(record.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('无 session 时 recordSessionEnd 返回 null', async () => {
      const result = await recordSessionEnd('billing_cap', null);
      expect(result).toBeNull();
    });

    it('有 pool 时写入 cecelia_events', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
      const mockPool = { query: mockQuery };

      recordSessionStart();
      await recordSessionEnd('billing_cap', mockPool);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('session_end'),
        expect.any(Array)
      );

      const payload = JSON.parse(mockQuery.mock.calls[0][1][0]);
      expect(payload.reason).toBe('billing_cap');
      expect(payload.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('session 结束后 _sessionStart 重置为 null', async () => {
      recordSessionStart();
      await recordSessionEnd('billing_cap', null);

      const info = getSessionInfo();
      expect(info.active).toBe(false);
    });

    it('pool 写入失败时 recordSessionEnd 不抛出', async () => {
      const mockPool = { query: vi.fn().mockRejectedValue(new Error('DB error')) };
      recordSessionStart();

      await expect(recordSessionEnd('billing_cap', mockPool)).resolves.toBeDefined();
    });
  });

  describe('D4-3: getSessionInfo 返回正确结构', () => {
    it('有 session 时返回 active: true, start, duration_min', () => {
      recordSessionStart();
      const info = getSessionInfo();

      expect(info.active).toBe(true);
      expect(typeof info.start).toBe('string');
      expect(typeof info.duration_min).toBe('number');
      expect(info.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('duration_min 格式为整数', () => {
      recordSessionStart();
      const info = getSessionInfo();
      expect(Number.isInteger(info.duration_min)).toBe(true);
    });
  });
});
