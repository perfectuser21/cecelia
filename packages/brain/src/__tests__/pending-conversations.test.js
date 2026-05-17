/**
 * pending-conversations.js 单元测试
 *
 * 覆盖所有导出函数：
 *   recordOutbound, resolveByPersonReply, shouldFollowUp, checkPendingFollowups, getOpenConversations
 *
 * 设计说明：
 * - pending-conversations.js 不 import db.js，所有函数接受 pool 参数
 * - 直接传入 mock pool 对象，无需 vi.mock 模块
 * - shouldFollowUp 内部使用 Math.random()，用 vi.spyOn 控制
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  recordOutbound,
  resolveByPersonReply,
  shouldFollowUp,
  checkPendingFollowups,
  getOpenConversations,
} from '../pending-conversations.js';

// ---------- 辅助工厂 ----------

const makePool = () => ({
  query: vi.fn(),
});

/**
 * 构造一条 pending_conversations 行
 * @param {Object} overrides
 */
const makeConv = (overrides = {}) => ({
  id: 'uuid-abc',
  person_id: 'owner',
  message: '你收到任务完成通知了吗？',
  context: '任务 #42 已完成',
  context_type: 'task_completion',
  importance: 0.5,
  sent_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2小时前
  followed_up_count: 0,
  last_followup_at: null,
  resolved_at: null,
  ...overrides,
});

// ---------- 测试 ----------

describe('pending-conversations', () => {
  let pool;

  beforeEach(() => {
    pool = makePool();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== recordOutbound ====================

  describe('recordOutbound', () => {
    it('默认参数时插入记录并返回 id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'new-uuid-1' }] });

      const id = await recordOutbound(pool, 'Cecelia 说了一句话');

      expect(id).toBe('new-uuid-1');
      expect(pool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO pending_conversations');
      expect(sql).toContain('RETURNING id');
      // 默认值：personId='owner', context=null, contextType='other', importance=0.5
      expect(params[0]).toBe('owner');
      expect(params[1]).toBe('Cecelia 说了一句话');
      expect(params[2]).toBeNull();
      expect(params[3]).toBe('other');
      expect(params[4]).toBe(0.5);
    });

    it('自定义 options 时写入正确参数', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'new-uuid-2' }] });

      const id = await recordOutbound(pool, '任务 #99 已完成，请确认', {
        personId: 'alex',
        context: '任务 #99',
        contextType: 'task_completion',
        importance: 0.9,
      });

      expect(id).toBe('new-uuid-2');
      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('alex');
      expect(params[3]).toBe('task_completion');
      expect(params[4]).toBe(0.9);
    });

    it('数据库返回空 rows 时返回 null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const id = await recordOutbound(pool, '消息');

      expect(id).toBeNull();
    });

    it('数据库异常时静默返回 null（不抛出）', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

      const id = await recordOutbound(pool, '消息');

      expect(id).toBeNull();
    });

    it('rows[0] 无 id 字段时返回 null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}] });

      const id = await recordOutbound(pool, '消息');

      expect(id).toBeNull();
    });
  });

  // ==================== resolveByPersonReply ====================

  describe('resolveByPersonReply', () => {
    it('默认参数时 UPDATE owner 的所有未 resolved 记录', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 2 });

      await resolveByPersonReply(pool);

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE pending_conversations');
      expect(sql).toContain('resolved_at');
      expect(sql).toContain('WHERE person_id = $1 AND resolved_at IS NULL');
      expect(params[0]).toBe('owner');
      expect(params[1]).toBe('user_reply');
    });

    it('自定义 personId 和 resolveSource', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await resolveByPersonReply(pool, 'alex', 'manual_dismiss');

      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('alex');
      expect(params[1]).toBe('manual_dismiss');
    });

    it('rowCount=0 时不打印日志（无已 pending 消息），也不抛出', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      const consoleSpy = vi.spyOn(console, 'log');

      await resolveByPersonReply(pool);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('rowCount>0 时打印 log', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 3 });
      const consoleSpy = vi.spyOn(console, 'log');

      await resolveByPersonReply(pool, 'owner');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('resolved 3 pending conversations')
      );
    });

    it('数据库异常时静默不抛出', async () => {
      pool.query.mockRejectedValueOnce(new Error('timeout'));

      await expect(resolveByPersonReply(pool)).resolves.toBeUndefined();
    });
  });

  // ==================== shouldFollowUp ====================

  describe('shouldFollowUp', () => {
    it('followed_up_count 达到上限（3）时返回 false', () => {
      const conv = makeConv({ followed_up_count: 3 });

      expect(shouldFollowUp(conv)).toBe(false);
    });

    it('followed_up_count 超过上限时返回 false', () => {
      const conv = makeConv({ followed_up_count: 5 });

      expect(shouldFollowUp(conv)).toBe(false);
    });

    it('last_followup_at 不足 1 小时时返回 false', () => {
      const conv = makeConv({
        followed_up_count: 1,
        last_followup_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30分钟前
      });

      expect(shouldFollowUp(conv)).toBe(false);
    });

    it('importance=1.0 时（最高重要性）阈值随机任意值下返回 true', () => {
      // importance=1.0 + urgencyBonus>=0 → threshold 必须 < 1.0 才返回 true
      // Math.random() 永远 < 1.0，所以 importance=1.0 的消息总应跟进
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const conv = makeConv({
        followed_up_count: 0,
        importance: 1.0,
        sent_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString(), // 1小时前
      });

      // importance(1.0) + urgencyBonus(min(1/8, 0.3)=0.125) = 1.125 > 0.99
      expect(shouldFollowUp(conv)).toBe(true);
    });

    it('importance=0 且 sent_at 极新（urgencyBonus≈0）时阈值>0 返回 false', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const conv = makeConv({
        followed_up_count: 0,
        importance: 0,
        sent_at: new Date(Date.now() - 100).toISOString(), // 刚发出
        last_followup_at: null,
      });

      // importance(0) + urgencyBonus(≈0) = ~0 < 0.5
      expect(shouldFollowUp(conv)).toBe(false);
    });

    it('沉默 8 小时后 urgencyBonus 达到上限 0.3', () => {
      // urgencyBonus = min(8/8, 0.3) = 0.3
      // importance=0.5 + 0.3 = 0.8 → random=0.79 时应跟进
      vi.spyOn(Math, 'random').mockReturnValue(0.79);
      const conv = makeConv({
        followed_up_count: 0,
        importance: 0.5,
        sent_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
        last_followup_at: null,
      });

      expect(shouldFollowUp(conv)).toBe(true);
    });

    it('last_followup_at 超过 1 小时时不被间隔限制', () => {
      // 距上次跟进 2 小时，满足间隔条件
      vi.spyOn(Math, 'random').mockReturnValue(0.01); // 极低阈值，几乎必然跟进
      const conv = makeConv({
        followed_up_count: 1,
        importance: 0.5,
        sent_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        last_followup_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      });

      expect(shouldFollowUp(conv)).toBe(true);
    });

    it('概率边界：(importance + urgencyBonus) 小于 random 时返回 false', () => {
      // 使用 1h55m 前（6900s），urgencyBonus = min(6900/28800, 0.3) ≈ 0.2396
      // importance(0.5) + urgencyBonus(≈0.24) ≈ 0.74 < 0.75 → false
      // 避免精确 2h 边界：Date.now() 在 makeConv 和 shouldFollowUp 之间有微小时差
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      const conv = makeConv({
        followed_up_count: 0,
        importance: 0.5,
        sent_at: new Date(Date.now() - 6900 * 1000).toISOString(),
        last_followup_at: null,
      });

      // (0.5 + ~0.24) > 0.75 is false
      expect(shouldFollowUp(conv)).toBe(false);
    });
  });

  // ==================== checkPendingFollowups ====================

  describe('checkPendingFollowups', () => {
    it('无待跟进消息时返回空数组', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await checkPendingFollowups(pool);

      expect(result).toEqual([]);
      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('WHERE resolved_at IS NULL');
      expect(sql).toContain('followed_up_count < $1');
      expect(params[0]).toBe(3); // MAX_FOLLOWUP_COUNT
    });

    it('shouldFollowUp 全部返回 false 时返回空数组，不执行 UPDATE', async () => {
      // importance=0, 刚发出，Math.random 返回高值
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const conv = makeConv({
        importance: 0,
        sent_at: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      pool.query.mockResolvedValueOnce({ rows: [conv] });

      const result = await checkPendingFollowups(pool);

      expect(result).toEqual([]);
      // 只有 SELECT，没有 UPDATE
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('shouldFollowUp 返回 true 的消息会被 UPDATE 并返回', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01); // 极低阈值，必然跟进
      const conv1 = makeConv({ id: 'uuid-1', importance: 0.8 });
      const conv2 = makeConv({ id: 'uuid-2', importance: 0.9 });
      pool.query
        .mockResolvedValueOnce({ rows: [conv1, conv2] }) // SELECT
        .mockResolvedValueOnce({ rowCount: 2 });          // UPDATE

      const result = await checkPendingFollowups(pool);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('uuid-1');
      expect(result[1].id).toBe('uuid-2');

      // 确认 UPDATE 被调用，且传入了正确的 ids
      expect(pool.query).toHaveBeenCalledTimes(2);
      const [updateSql, updateParams] = pool.query.mock.calls[1];
      expect(updateSql).toContain('followed_up_count = followed_up_count + 1');
      expect(updateSql).toContain('last_followup_at = NOW()');
      expect(updateSql).toContain('WHERE id = ANY($1::uuid[])');
      expect(updateParams[0]).toEqual(['uuid-1', 'uuid-2']);
    });

    it('部分消息通过 shouldFollowUp，只 UPDATE 通过的', async () => {
      // conv1 importance 高 → 跟进；conv2 importance=0 且新鲜 → 不跟进
      const conv1 = makeConv({ id: 'uuid-yes', importance: 1.0 });
      const conv2 = makeConv({
        id: 'uuid-no',
        importance: 0,
        sent_at: new Date(Date.now() - 100).toISOString(),
      });

      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // conv1: 1.0 + urgencyBonus > 0.5 → true
      // conv2: 0 + ~0 > 0.5 → false

      pool.query
        .mockResolvedValueOnce({ rows: [conv1, conv2] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await checkPendingFollowups(pool);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('uuid-yes');

      const updateParams = pool.query.mock.calls[1][1];
      expect(updateParams[0]).toEqual(['uuid-yes']);
    });

    it('SELECT 查询异常时返回空数组，不抛出', async () => {
      pool.query.mockRejectedValueOnce(new Error('query timeout'));

      const result = await checkPendingFollowups(pool);

      expect(result).toEqual([]);
    });

    it('UPDATE 异常时返回空数组，不抛出', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      const conv = makeConv({ importance: 1.0 });
      pool.query
        .mockResolvedValueOnce({ rows: [conv] })
        .mockRejectedValueOnce(new Error('update failed'));

      const result = await checkPendingFollowups(pool);

      expect(result).toEqual([]);
    });

    it('SELECT 查询包含正确的排序条件', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await checkPendingFollowups(pool);

      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY sent_at ASC');
    });
  });

  // ==================== getOpenConversations ====================

  describe('getOpenConversations', () => {
    it('默认查询 owner 的未 resolved 消息', async () => {
      const convs = [makeConv(), makeConv({ id: 'uuid-2', message: '另一条消息' })];
      pool.query.mockResolvedValueOnce({ rows: convs });

      const result = await getOpenConversations(pool);

      expect(result).toEqual(convs);
      expect(result).toHaveLength(2);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('WHERE person_id = $1 AND resolved_at IS NULL');
      expect(sql).toContain('ORDER BY sent_at DESC');
      expect(sql).toContain('LIMIT 20');
      expect(params[0]).toBe('owner');
    });

    it('自定义 personId 查询', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await getOpenConversations(pool, 'alex');

      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('alex');
    });

    it('无未回应消息时返回空数组', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getOpenConversations(pool);

      expect(result).toEqual([]);
    });

    it('返回消息按 sent_at DESC 排序（DB 保证）', async () => {
      const older = makeConv({ id: 'old', sent_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
      const newer = makeConv({ id: 'new', sent_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString() });
      // DB 按 DESC 返回，newer 在前
      pool.query.mockResolvedValueOnce({ rows: [newer, older] });

      const result = await getOpenConversations(pool);

      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('old');
    });

    it('数据库异常时返回空数组，不抛出', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection refused'));

      const result = await getOpenConversations(pool);

      expect(result).toEqual([]);
    });
  });
});
