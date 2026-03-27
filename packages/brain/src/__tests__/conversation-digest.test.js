/**
 * Conversation Digest 测试
 *
 * T1: 模块导出正确（scanLogDirectory / analyzeWithCortex / persistDigest / runConversationDigest）
 * T2: persistDigest 双写 — 同时写入 conversation_captures 和 captures 表（source='conversation'）
 * T3: persistDigest 无 analysis 时不执行任何写入
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool (db.js)
const mockQuery = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: {
    query: mockQuery,
    connect: mockConnect,
  },
}));

import { persistDigest, analyzeWithCortex } from '../conversation-digest.js';

describe('Conversation Digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: 模块导出关键函数', async () => {
    const mod = await import('../conversation-digest.js');
    expect(typeof mod.scanLogDirectory).toBe('function');
    expect(typeof mod.analyzeWithCortex).toBe('function');
    expect(typeof mod.persistDigest).toBe('function');
    expect(typeof mod.runConversationDigest).toBe('function');
  });

  it('T2: persistDigest 执行双写 — conversation_captures + captures(source=conversation)', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const clientRelease = vi.fn();
    mockConnect.mockResolvedValue({
      query: clientQuery,
      release: clientRelease,
    });

    const analysis = {
      summary: '本次对话核心：完成 Kanban Board 开发',
      decisions: ['GTDInbox 改为三列看板', 'conversation-digest 写双表'],
      ideas: ['未来支持拖拽排序'],
      open_questions: [],
      tensions: [],
    };

    await persistDigest(analysis, '/test/file.jsonl', 'test-slug', 'capture-id-123');

    const allSql = clientQuery.mock.calls.map(c => c[0]);

    // 必须有 INSERT INTO captures
    const hasCaptures = allSql.some(sql =>
      typeof sql === 'string' && sql.includes('INSERT INTO captures')
    );
    expect(hasCaptures).toBe(true);

    // captures INSERT SQL 必须包含 source='conversation' 硬编码字符串
    const capturesCall = clientQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO captures')
    );
    expect(capturesCall).toBeDefined();
    // source 是 SQL 中硬编码的 'conversation'，而非参数
    expect(capturesCall[0]).toContain("'conversation'");

    // 必须有 UPDATE conversation_captures
    const hasConvCaptures = allSql.some(sql =>
      typeof sql === 'string' && sql.includes('UPDATE conversation_captures')
    );
    expect(hasConvCaptures).toBe(true);

    // 事务必须 BEGIN + COMMIT
    const hasBegin = allSql.some(sql => sql === 'BEGIN');
    const hasCommit = allSql.some(sql => sql === 'COMMIT');
    expect(hasBegin).toBe(true);
    expect(hasCommit).toBe(true);

    // client 必须 release
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it('T3: persistDigest(null) 不执行任何 DB 操作', async () => {
    await persistDigest(null, '/test/file.jsonl', 'slug', 'cap-id');
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
