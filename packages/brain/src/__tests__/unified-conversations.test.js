/**
 * unified-conversations.test.js
 *
 * 测试 unified_conversations 表的迁移和相关函数行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock pool ──────────────────────────────────────────────────────────────
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// ── 不 import routes.js（太重），直接内联测试同款逻辑 ──────────────────────

async function getUnifiedHistory(pool, participantId, rounds = 10, groupId = null) {
  let res;
  if (groupId) {
    res = await pool.query(
      `SELECT role, content, image_description FROM unified_conversations
       WHERE group_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [groupId, rounds * 2]
    );
  } else {
    res = await pool.query(
      `SELECT role, content, image_description FROM unified_conversations
       WHERE participant_id = $1 AND group_id IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [participantId, rounds * 2]
    );
  }
  return res.rows.reverse().map(r => ({
    role: r.role,
    content: r.image_description
      ? `${r.content}（你之前描述过这张图片：${r.image_description.slice(0, 120)}）`
      : r.content,
  }));
}

async function saveUnifiedConversation(pool, participantId, channel, groupId, userText, assistantReply, imageDescription = null) {
  await pool.query(
    `INSERT INTO unified_conversations (participant_id, channel, group_id, role, content, image_description)
     VALUES ($1, $2, $3, 'user', $4, $5), ($1, $2, $3, 'assistant', $6, NULL)`,
    [participantId, channel, groupId || null, userText, imageDescription, assistantReply]
  );
}

const mockPool = { query: mockQuery };

// ──────────────────────────────────────────────────────────────────────────

describe('UC1: getUnifiedHistory - P2P（无 image_description）', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    // DB 返回 DESC 顺序（最新在前）：assistant 在前，user 在后
    mockQuery.mockResolvedValue({
      rows: [
        { role: 'assistant', content: '你也好', image_description: null },
        { role: 'user', content: '你好', image_description: null },
      ],
    });
  });

  it('UC1-1: reverse() 后返回时间正序（user 在前）', async () => {
    const result = await getUnifiedHistory(mockPool, 'ou_abc', 10, null);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('你好');
    expect(result[1].role).toBe('assistant');
  });

  it('UC1-2: 没有 image_description 时 content 不变', async () => {
    const result = await getUnifiedHistory(mockPool, 'ou_abc', 10, null);
    expect(result[0].content).toBe('你好');
    expect(result[1].content).toBe('你也好');
  });

  it('UC1-3: SQL 使用 participant_id + group_id IS NULL 过滤', async () => {
    await getUnifiedHistory(mockPool, 'ou_abc', 10, null);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('group_id IS NULL');
    expect(call[1][0]).toBe('ou_abc');
    expect(call[1][1]).toBe(20); // 10 rounds * 2
  });
});

describe('UC2: getUnifiedHistory - 图片消息（有 image_description）', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    // DB DESC 顺序：assistant 在前（无 image_description），user 在后（有 image_description）
    mockQuery.mockResolvedValue({
      rows: [
        { role: 'assistant', content: '这张图写着"限制你的不是不会，是你不试"，很有力量！', image_description: null },
        { role: 'user', content: '[图片]', image_description: '限制你的不是不会，是你不试' },
      ],
    });
  });

  it('UC2-1: 图片用户消息注入 image_description 提示', async () => {
    const result = await getUnifiedHistory(mockPool, 'ou_abc', 10, null);
    // reverse() 后 user 在 index 0
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('你之前描述过这张图片：');
    expect(result[0].content).toContain('限制你的不是不会');
  });

  it('UC2-2: assistant 消息没有 image_description 时不注入', async () => {
    const result = await getUnifiedHistory(mockPool, 'ou_abc', 10, null);
    // reverse() 后 assistant 在 index 1
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).not.toContain('你之前描述过');
  });
});

describe('UC3: getUnifiedHistory - 群聊（按 group_id）', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({
      rows: [
        { role: 'assistant', content: '大家好', image_description: null },
        { role: 'user', content: '群里好', image_description: null },
      ],
    });
  });

  it('UC3-1: 群聊 SQL 使用 WHERE group_id = $1', async () => {
    await getUnifiedHistory(mockPool, 'ou_abc', 10, 'oc_groupchat123');
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('WHERE group_id = $1');
    expect(call[1][0]).toBe('oc_groupchat123');
  });

  it('UC3-2: 群聊 SQL 不过滤 participant_id', async () => {
    await getUnifiedHistory(mockPool, 'ou_abc', 10, 'oc_groupchat123');
    const call = mockQuery.mock.calls[0];
    expect(call[0]).not.toContain('participant_id');
  });
});

describe('UC4: saveUnifiedConversation', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('UC4-1: P2P 保存时 channel=feishu_p2p, group_id=null', async () => {
    await saveUnifiedConversation(mockPool, 'ou_abc', 'feishu_p2p', null, '你好', '你也好');
    const call = mockQuery.mock.calls[0];
    expect(call[1][1]).toBe('feishu_p2p'); // channel 是 params[1]
    expect(call[1][2]).toBeNull(); // groupId
    expect(call[1][5]).toBe('你也好'); // assistantReply
  });

  it('UC4-2: 群聊保存时 group_id 正确写入', async () => {
    await saveUnifiedConversation(mockPool, 'ou_abc', 'feishu_group', 'oc_group456', 'hi', 'hello');
    const call = mockQuery.mock.calls[0];
    expect(call[1][2]).toBe('oc_group456');
  });

  it('UC4-3: 图片消息 image_description 存入 user 行', async () => {
    await saveUnifiedConversation(mockPool, 'ou_abc', 'feishu_p2p', null, '[图片]', '这张图写着：加油', '这张图写着：加油');
    const call = mockQuery.mock.calls[0];
    expect(call[1][4]).toBe('这张图写着：加油'); // imageDescription 在 params[4]
  });

  it('UC4-4: 非图片消息 image_description 为 null', async () => {
    await saveUnifiedConversation(mockPool, 'ou_abc', 'feishu_p2p', null, '你好', '你也好', null);
    const call = mockQuery.mock.calls[0];
    expect(call[1][4]).toBeNull();
  });

  it('UC4-5: Dashboard 对话 channel=dashboard, participant_id=owner', async () => {
    await saveUnifiedConversation(mockPool, 'owner', 'dashboard', null, '今天怎样', '还不错', null);
    const call = mockQuery.mock.calls[0];
    expect(call[1][1]).toBe('dashboard'); // channel 是 params[1]
    expect(call[1][0]).toBe('owner');
  });
});

describe('UC5: migration 108 SQL 结构验证', () => {
  it('UC5-1: 迁移文件存在', async () => {
    const { existsSync } = await import('fs');
    const path = new URL('../../migrations/108_unified_conversations.sql', import.meta.url);
    expect(existsSync(path)).toBe(true);
  });

  it('UC5-2: 包含所有必要字段和约束', async () => {
    const { readFileSync } = await import('fs');
    const path = new URL('../../migrations/108_unified_conversations.sql', import.meta.url);
    const sql = readFileSync(path, 'utf8');
    expect(sql).toContain('participant_id');
    expect(sql).toContain('channel');
    expect(sql).toContain('group_id');
    expect(sql).toContain('image_description');
    expect(sql).toContain('feishu_p2p');
    expect(sql).toContain('feishu_group');
    expect(sql).toContain('dashboard');
  });
});
