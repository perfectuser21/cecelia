/**
 * Chat Action Dispatcher 测试
 *
 * 验证 detectAction / executeAction / detectAndExecuteAction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// Mock actions.js
const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
}));

import { detectAction, executeAction, detectAndExecuteAction } from '../chat-action-dispatcher.js';

describe('detectAction', () => {
  it('D1-1: 识别 "帮我记个任务：xxx"', () => {
    const result = detectAction('帮我记个任务：完成周报');
    expect(result).toEqual({ type: 'CREATE_TASK', params: { title: '完成周报' } });
  });

  it('D1-2: 识别 "新建任务：xxx"', () => {
    const result = detectAction('新建任务：整理文档');
    expect(result).toEqual({ type: 'CREATE_TASK', params: { title: '整理文档' } });
  });

  it('D1-3: 识别 "创建任务：xxx"', () => {
    const result = detectAction('创建任务：回复邮件');
    expect(result).toEqual({ type: 'CREATE_TASK', params: { title: '回复邮件' } });
  });

  it('D2: 识别 "记录学习：xxx"', () => {
    const result = detectAction('记录学习：测试时要先 mock fs');
    expect(result).toEqual({ type: 'CREATE_LEARNING', params: { title: '测试时要先 mock fs' } });
  });

  it('D2-2: 识别 "学到了：xxx"', () => {
    const result = detectAction('学到了：异步 mock 要用 hoisted');
    expect(result).toEqual({ type: 'CREATE_LEARNING', params: { title: '异步 mock 要用 hoisted' } });
  });

  it('D3-1: 识别 "任务状态" → QUERY_STATUS', () => {
    const result = detectAction('告诉我任务状态');
    expect(result).toEqual({ type: 'QUERY_STATUS', params: {} });
  });

  it('D3-2: 识别 "OKR进度" → QUERY_GOALS', () => {
    const result = detectAction('查一下OKR进度');
    expect(result).toEqual({ type: 'QUERY_GOALS', params: {} });
  });

  it('D4: 无关消息返回 null', () => {
    expect(detectAction('你好')).toBeNull();
    expect(detectAction('告诉我天气')).toBeNull();
    expect(detectAction('这个系统怎么样')).toBeNull();
  });

  it('D4-2: 空消息返回 null', () => {
    expect(detectAction('')).toBeNull();
    expect(detectAction(null)).toBeNull();
  });
});

describe('executeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('D5-1: CREATE_TASK 成功 → 返回 ✅ 确认文本', async () => {
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'uuid', title: '完成周报' } });

    const result = await executeAction({ type: 'CREATE_TASK', params: { title: '完成周报' } });

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: '完成周报',
      priority: 'P2',
      task_type: 'research',
      trigger_source: 'chat',
    });
    expect(result).toContain('✅ 已创建任务：完成周报');
  });

  it('D5-2: CREATE_TASK 无标题 → 返回 ⚠️', async () => {
    const result = await executeAction({ type: 'CREATE_TASK', params: { title: '' } });
    expect(result).toContain('⚠️ 创建任务失败');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('D5-3: CREATE_TASK 去重 → 确认文本含"已存在"', async () => {
    mockCreateTask.mockResolvedValueOnce({ success: true, deduplicated: true, task: { id: 'uuid' } });

    const result = await executeAction({ type: 'CREATE_TASK', params: { title: '完成周报' } });
    expect(result).toContain('已存在');
  });

  it('D6: CREATE_LEARNING → 写入 learnings 表 + 返回 ✅', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executeAction({ type: 'CREATE_LEARNING', params: { title: '测试时要先 mock fs' } });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO learnings'),
      expect.arrayContaining(['测试时要先 mock fs', 'manual'])
    );
    expect(result).toContain('✅ 已记录学习：测试时要先 mock fs');
  });

  it('D7: QUERY_STATUS → 返回 📊 统计文本', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { status: 'queued', cnt: 3 },
        { status: 'in_progress', cnt: 1 },
      ],
    });

    const result = await executeAction({ type: 'QUERY_STATUS', params: {} });

    expect(result).toContain('📊');
    expect(result).toContain('queued');
    expect(result).toContain('3');
  });

  it('D7-2: QUERY_STATUS 空结果 → 提示暂无任务', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await executeAction({ type: 'QUERY_STATUS', params: {} });
    expect(result).toContain('暂无任务');
  });

  it('D8: executeAction 失败 → 返回 ⚠️ 文本，不抛异常', async () => {
    mockCreateTask.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await executeAction({ type: 'CREATE_TASK', params: { title: '任务' } });
    expect(result).toContain('⚠️');
    expect(result).toContain('DB connection failed');
  });

  it('D8-2: 未知动作类型返回空字符串', async () => {
    const result = await executeAction({ type: 'UNKNOWN_TYPE', params: {} });
    expect(result).toBe('');
  });

  it('null 参数返回空字符串', async () => {
    const result = await executeAction(null);
    expect(result).toBe('');
  });
});

describe('detectAndExecuteAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('D4-3: 无意图消息返回空字符串', async () => {
    const result = await detectAndExecuteAction('你好');
    expect(result).toBe('');
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('D5-4: 有意图消息 → 执行动作', async () => {
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'uuid', title: '整理文档' } });

    const result = await detectAndExecuteAction('帮我记个任务：整理文档');
    expect(result).toContain('✅ 已创建任务：整理文档');
  });
});
