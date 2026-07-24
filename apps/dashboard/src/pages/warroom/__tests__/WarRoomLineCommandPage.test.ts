/**
 * WarRoomLineCommandPage 纯函数单测
 *
 * [BEHAVIOR] B1 — turnMarkerLabel: chat/null → null（不显示标记）
 * [BEHAVIOR] B2 — turnMarkerLabel: pending_user → '等待拍板'
 * [BEHAVIOR] B3 — turnMarkerLabel: decision_saved=<uuid> → '已落决策'
 * [BEHAVIOR] B4 — convTitle: 有 title 时显示 title，无 title 时显示短 id 占位
 * [BEHAVIOR] B5 — truncateMsg: 短文本原样返回，超长文本加省略号截断
 */

import { describe, it, expect } from 'vitest';
import { turnMarkerLabel, convTitle, truncateMsg } from '../WarRoomLineCommandPage';

describe('turnMarkerLabel', () => {
  it('[B1] null → null', () => {
    expect(turnMarkerLabel(null)).toBeNull();
  });

  it('[B1] "chat" → null（纯聊天，不显示标记）', () => {
    expect(turnMarkerLabel('chat')).toBeNull();
  });

  it('[B2] "pending_user" → "等待拍板"', () => {
    expect(turnMarkerLabel('pending_user')).toBe('等待拍板');
  });

  it('[B3] "decision_saved=<uuid>" → "已落决策"', () => {
    expect(turnMarkerLabel('decision_saved=123e4567-e89b-12d3-a456-426614174000')).toBe('已落决策');
  });

  it('[B3] decision_saved 前缀匹配（短 id 也覆盖）', () => {
    expect(turnMarkerLabel('decision_saved=abc')).toBe('已落决策');
  });

  it('[B1] 未知标记 → null', () => {
    expect(turnMarkerLabel('unknown_marker')).toBeNull();
  });
});

describe('convTitle', () => {
  it('[B4] 有 title 时返回 title', () => {
    expect(convTitle({ title: '讨论下周发布', id: 'aaaabbbb-0000-0000-0000-000000000001' }))
      .toBe('讨论下周发布');
  });

  it('[B4] title 为 null 时返回 "对话 #<id前6位>"', () => {
    expect(convTitle({ title: null, id: 'abcdef12-0000-0000-0000-000000000001' }))
      .toBe('对话 #abcdef');
  });

  it('[B4] title 为空字符串时（falsy）返回占位', () => {
    expect(convTitle({ title: '', id: 'zxcvbn00-0000-0000-0000-000000000001' }))
      .toBe('对话 #zxcvbn');
  });
});

describe('truncateMsg', () => {
  it('[B5] 短文本原样返回', () => {
    expect(truncateMsg('短文本', 60)).toBe('短文本');
  });

  it('[B5] 恰好 maxLen 不截断', () => {
    const text = 'a'.repeat(60);
    expect(truncateMsg(text, 60)).toBe(text);
  });

  it('[B5] 超长文本在 maxLen 处截断 + 省略号', () => {
    const text = 'a'.repeat(61);
    const result = truncateMsg(text, 60);
    expect(result).toHaveLength(61); // 60 chars + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('[B5] 默认 maxLen=60', () => {
    const text = 'b'.repeat(70);
    const result = truncateMsg(text);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(61);
  });
});
