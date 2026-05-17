/**
 * memory-utils.js 单元测试
 *
 * 覆盖所有导出函数：
 *   generateL0Summary          - 纯函数，无外部依赖
 *   generateMemoryStreamL1Async - 异步 fire-and-forget，依赖 llm-caller.js（dynamic import）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock llm-caller.js（generateMemoryStreamL1Async 内部 dynamic import） ──
// 必须在 import 目标模块之前声明，vi.mock 会被 vitest 自动提升（hoisted）
const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

import { generateL0Summary, generateMemoryStreamL1Async } from '../memory-utils.js';

// ============================================================
// generateL0Summary
// ============================================================

describe('generateL0Summary', () => {
  // MU-1: 正常内容截取前 100 字符
  it('MU-1: 正常内容返回前 100 字符', () => {
    const content = 'a'.repeat(200);
    const result = generateL0Summary(content);
    expect(result).toBe('a'.repeat(100));
    expect(result).toHaveLength(100);
  });

  // MU-2: 内容不足 100 字符时原样返回（去首尾空格）
  it('MU-2: 内容不足 100 字符时完整返回', () => {
    const content = 'hello world';
    expect(generateL0Summary(content)).toBe('hello world');
  });

  // MU-3: 恰好 100 字符时完整保留
  it('MU-3: 恰好 100 字符时完整返回', () => {
    const content = 'x'.repeat(100);
    expect(generateL0Summary(content)).toBe(content);
  });

  // MU-4: 内容为空字符串时返回空字符串
  it('MU-4: 空字符串返回空字符串', () => {
    expect(generateL0Summary('')).toBe('');
  });

  // MU-5: null/undefined 返回空字符串
  it('MU-5: null 返回空字符串', () => {
    expect(generateL0Summary(null)).toBe('');
  });

  it('MU-6: undefined 返回空字符串', () => {
    expect(generateL0Summary(undefined)).toBe('');
  });

  // MU-7: 多余空白字符被折叠为单空格
  it('MU-7: 多余空白折叠为单空格', () => {
    const content = 'hello   world\n\tfoo   bar';
    expect(generateL0Summary(content)).toBe('hello world foo bar');
  });

  // MU-8: 首尾空白被 trim 掉
  it('MU-8: 首尾空白被裁剪', () => {
    expect(generateL0Summary('  hello world  ')).toBe('hello world');
  });

  // MU-9: 换行 + 超长内容组合：先折叠空白再截取 100
  it('MU-9: 换行折叠后超长内容仍截取到 100 字符', () => {
    // 每行 10 字，共 20 行 = 原始 210 字（含换行），折叠后 200 字，取前 100
    const line = 'abcdefghij'; // 10 chars
    const content = Array(20).fill(line).join('\n');
    const result = generateL0Summary(content);
    // 折叠后变为 "abcdefghij abcdefghij ..."（每词10字+1空格）
    expect(result.length).toBe(100);
    expect(result).not.toContain('\n');
  });

  // MU-10: 纯空白字符串返回空字符串
  it('MU-10: 纯空白字符串返回空字符串', () => {
    expect(generateL0Summary('   \n\t  ')).toBe('');
  });
});

// ============================================================
// generateMemoryStreamL1Async
// ============================================================

describe('generateMemoryStreamL1Async', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockCallLLM.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 守卫：参数缺失时立即返回，不触发任何异步 ─────────────────────

  // MU-11: recordId 为空时不触发异步，立即返回
  it('MU-11: recordId 为 null 时不触发 LLM 调用', async () => {
    generateMemoryStreamL1Async(null, '内容', mockPool);
    // flush microtask queue
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  // MU-12: content 为空时不触发异步
  it('MU-12: content 为空字符串时不触发 LLM 调用', async () => {
    generateMemoryStreamL1Async(42, '', mockPool);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // MU-13: pool 为空时不触发异步
  it('MU-13: pool 为 null 时不触发 LLM 调用', async () => {
    generateMemoryStreamL1Async(42, '内容', null);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // MU-14: recordId/content/pool 均为 undefined 时不触发
  it('MU-14: 全部参数为 undefined 时不触发 LLM 调用', async () => {
    generateMemoryStreamL1Async(undefined, undefined, undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // ── 正常路径 ──────────────────────────────────────────────────────

  // MU-15: 正常调用 LLM 并用结果更新 memory_stream
  it('MU-15: 正常生成 L1 并执行 UPDATE SQL', async () => {
    const l1Text = '**核心事实**：测试\n**背景场景**：单元测试\n**关键判断**：有效\n**相关实体**：vitest';
    mockCallLLM.mockResolvedValueOnce({ text: l1Text });

    generateMemoryStreamL1Async(99, '这是一段完整的记忆内容', mockPool);

    // 等待 Promise.resolve().then(async () => {...}) 内部完全执行
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledWith(
      'memory',
      expect.stringContaining('这是一段完整的记忆内容'),
      expect.objectContaining({ timeout: 90000, maxTokens: 300 })
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE memory_stream SET l1_content = $1 WHERE id = $2',
      [l1Text.trim(), 99]
    );
  });

  // MU-16: prompt 包含四个 L1 格式字段标签
  it('MU-16: 发送给 LLM 的 prompt 包含四个结构化字段标签', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '**核心事实**：ok' });

    generateMemoryStreamL1Async('rec-1', '记忆内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    const prompt = mockCallLLM.mock.calls[0][1];
    expect(prompt).toContain('**核心事实**');
    expect(prompt).toContain('**背景场景**');
    expect(prompt).toContain('**关键判断**');
    expect(prompt).toContain('**相关实体**');
  });

  // MU-17: content 超过 1500 字时 prompt 中内容被截断
  it('MU-17: content 超过 1500 字时 prompt 中仅包含前 1500 字', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '**核心事实**：ok' });

    const longContent = 'Z'.repeat(2000);
    generateMemoryStreamL1Async('rec-2', longContent, mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    const prompt = mockCallLLM.mock.calls[0][1];
    expect(prompt).toContain('Z'.repeat(1500));
    expect(prompt).not.toContain('Z'.repeat(1501));
  });

  // MU-18: LLM 返回值被 trim 后写入数据库
  it('MU-18: LLM 返回值的首尾空白被 trim 后写入 DB', async () => {
    const rawText = '  **核心事实**：有空白  ';
    mockCallLLM.mockResolvedValueOnce({ text: rawText });

    generateMemoryStreamL1Async(7, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    const dbParams = mockPool.query.mock.calls[0][1];
    expect(dbParams[0]).toBe(rawText.trim());
  });

  // MU-19: 函数为 fire-and-forget，返回值为 undefined（同步立即返回）
  it('MU-19: 函数同步返回 undefined（fire-and-forget）', () => {
    mockCallLLM.mockResolvedValueOnce({ text: '**核心事实**：ok' });
    const returnValue = generateMemoryStreamL1Async(1, '内容', mockPool);
    expect(returnValue).toBeUndefined();
  });

  // ── LLM 返回空/无效 ────────────────────────────────────────────────

  // MU-20: LLM 返回 null text 时不执行 DB 写入
  it('MU-20: LLM 返回 null text 时不写入数据库', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: null });

    generateMemoryStreamL1Async(10, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPool.query).not.toHaveBeenCalled();
  });

  // MU-21: LLM 返回空字符串时不执行 DB 写入
  it('MU-21: LLM 返回空字符串时不写入数据库', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '' });

    generateMemoryStreamL1Async(11, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPool.query).not.toHaveBeenCalled();
  });

  // MU-22: LLM 返回 undefined result 时不执行 DB 写入
  it('MU-22: LLM 返回 undefined 时不写入数据库', async () => {
    mockCallLLM.mockResolvedValueOnce(undefined);

    generateMemoryStreamL1Async(12, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPool.query).not.toHaveBeenCalled();
  });

  // ── 错误处理（fire-and-forget 不应向外抛出） ───────────────────────

  // MU-23: LLM 抛出异常时不向外传播（内部 catch + console.warn）
  it('MU-23: LLM 异常被静默处理，不向外传播', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCallLLM.mockRejectedValueOnce(new Error('LLM timeout'));

    // 不应抛出任何错误
    generateMemoryStreamL1Async(20, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPool.query).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[memory-utils]'),
      expect.stringContaining('LLM timeout')
    );
    warnSpy.mockRestore();
  });

  // MU-24: DB query 抛出异常时不向外传播
  it('MU-24: DB 写入异常被静默处理，不向外传播', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCallLLM.mockResolvedValueOnce({ text: '**核心事实**：内容' });
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    generateMemoryStreamL1Async(21, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[memory-utils]'),
      expect.stringContaining('DB connection lost')
    );
    warnSpy.mockRestore();
  });

  // MU-25: 错误日志包含 recordId 方便排查
  it('MU-25: 错误日志包含 recordId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCallLLM.mockRejectedValueOnce(new Error('network error'));

    generateMemoryStreamL1Async(42, '内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    // warn 第一个参数应包含 recordId "42"
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('42'),
      expect.any(String)
    );
    warnSpy.mockRestore();
  });

  // ── recordId 类型兼容性 ────────────────────────────────────────────

  // MU-26: recordId 为字符串类型时正常工作
  it('MU-26: recordId 为字符串时也能正常执行', async () => {
    const l1 = '**核心事实**：ok';
    mockCallLLM.mockResolvedValueOnce({ text: l1 });

    generateMemoryStreamL1Async('uuid-abc-123', '记忆内容', mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE memory_stream SET l1_content = $1 WHERE id = $2',
      [l1, 'uuid-abc-123']
    );
  });

  // MU-27: content 恰好 1500 字时不被截断
  it('MU-27: content 恰好 1500 字时完整传入 prompt', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '**核心事实**：ok' });

    const exact1500 = 'A'.repeat(1500);
    generateMemoryStreamL1Async('rec-3', exact1500, mockPool);
    await new Promise(resolve => setTimeout(resolve, 0));

    const prompt = mockCallLLM.mock.calls[0][1];
    expect(prompt).toContain('A'.repeat(1500));
  });
});
