/**
 * session-tracking.test.js
 *
 * 测试当前 Session helper 合同（不宣称实际派发链会自动开始 Session）：
 * - D4-1: 显式调用真实 recordSessionStart 仅首次记录，不覆盖
 * - D4-2: setBillingPause 调用时记录 session 结束，写入 cecelia_events
 * - D4-3: executor.getSessionInfo 返回正确结构（不宣称HTTP stats已覆盖）
 *
 * DoD 映射：
 * - D4-1 → '显式 Session helper 首次记录'
 * - D4-2 → 'setBillingPause 写入 session_end 事件'
 * - D4-3 → 'executor.getSessionInfo 返回正确结构'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Session 时长追踪 - D4', () => {
  beforeEach(() => {
    actualExecutor._resetSessionStart();
  });

  describe('D4-1: recordSessionStart 仅首次生效', () => {
    it('首次调用设置 _sessionStart', () => {
      const before = Date.now();
      actualExecutor.recordSessionStart();
      const after = Date.now();

      const info = actualExecutor.getSessionInfo();
      expect(info.active).toBe(true);
      expect(new Date(info.start).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(info.start).getTime()).toBeLessThanOrEqual(after);
    });

    it('多次调用不覆盖首次设置的时间', async () => {
      actualExecutor.recordSessionStart();
      const firstStart = actualExecutor.getSessionInfo().start;

      await new Promise(resolve => setTimeout(resolve, 5));
      actualExecutor.recordSessionStart(); // 第二次不应覆盖

      expect(actualExecutor.getSessionInfo().start).toBe(firstStart);
    });

    it('无 session 时 getSessionInfo 返回 active: false', () => {
      const info = actualExecutor.getSessionInfo();
      expect(info.active).toBe(false);
      expect(info.start).toBeUndefined();
    });
  });

  describe('D4-2: recordSessionEnd 写入 session_end 事件', () => {
    it('setBillingPause 后 recordSessionEnd 返回正确的 record', async () => {
      actualExecutor.recordSessionStart();
      const record = await actualExecutor.recordSessionEnd('billing_cap', null);

      expect(record).toBeDefined();
      expect(record.reason).toBe('billing_cap');
      expect(record.start).toBeDefined();
      expect(record.end).toBeDefined();
      expect(record.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('无 session 时 recordSessionEnd 返回 null', async () => {
      const result = await actualExecutor.recordSessionEnd('billing_cap', null);
      expect(result).toBeNull();
    });

    it('有 pool 时写入 cecelia_events', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
      const mockPool = { query: mockQuery };

      actualExecutor.recordSessionStart();
      await actualExecutor.recordSessionEnd('billing_cap', mockPool);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('session_end'),
        expect.any(Array)
      );

      const payload = JSON.parse(mockQuery.mock.calls[0][1][0]);
      expect(payload.reason).toBe('billing_cap');
      expect(payload.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('session 结束后 _sessionStart 重置为 null', async () => {
      actualExecutor.recordSessionStart();
      await actualExecutor.recordSessionEnd('billing_cap', null);

      const info = actualExecutor.getSessionInfo();
      expect(info.active).toBe(false);
    });

    it('pool 写入失败时 recordSessionEnd 不抛出', async () => {
      const mockPool = { query: vi.fn().mockRejectedValue(new Error('DB error')) };
      actualExecutor.recordSessionStart();

      await expect(actualExecutor.recordSessionEnd('billing_cap', mockPool)).resolves.toBeDefined();
    });
  });

  describe('D4-3: getSessionInfo 返回正确结构', () => {
    it('有 session 时返回 active: true, start, duration_min', () => {
      actualExecutor.recordSessionStart();
      const info = actualExecutor.getSessionInfo();

      expect(info.active).toBe(true);
      expect(typeof info.start).toBe('string');
      expect(typeof info.duration_min).toBe('number');
      expect(info.duration_min).toBeGreaterThanOrEqual(0);
    });

    it('duration_min 格式为整数', () => {
      actualExecutor.recordSessionStart();
      const info = actualExecutor.getSessionInfo();
      expect(Number.isInteger(info.duration_min)).toBe(true);
    });
  });
});

import {afterAll} from 'vitest';
vi.mock('../db.js',()=>({default:{query:vi.fn()}}));
import * as actualExecutor from '../executor.js';
const realStart=vi.spyOn(actualExecutor,'recordSessionStart');
afterAll(()=>expect(realStart).toHaveBeenCalled());

it('真实setBillingPause必须结束session并写入session_end事件',async()=>{
  actualExecutor._resetSessionStart();
  actualExecutor.recordSessionStart();
  const query=vi.fn().mockResolvedValue({rows:[]});
  actualExecutor.setBillingPause(new Date(Date.now()+60000).toISOString(),'fixture_cap',{query});
  await vi.waitFor(()=>expect(query.mock.calls.some(([sql])=>sql.includes("'session_end'"))).toBe(true));
  await vi.waitFor(()=>expect(actualExecutor.getSessionInfo()).toEqual({active:false}));
  actualExecutor.clearBillingPause();
});
