/**
 * skill-md-artifact.test.ts
 * Contract Test — PR4/4 D1 Skill 规程文件存在性验证
 *
 * [BEHAVIOR] B-04: SKILL.md 存在且含三个必需协议标记关键词
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const SKILL_PATH = '/workspace/packages/workflows/skills/conversation-agent/SKILL.md';

describe('D1 — conversation-agent SKILL.md 合同测试', () => {
  it('[B-04a] SKILL.md 文件存在（D1 未实现时 FAIL — TDD Red）', () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it('[B-04b] SKILL.md 含 decision_saved 协议标记', () => {
    if (!existsSync(SKILL_PATH)) {
      throw new Error('SKILL.md 不存在，D1 未实现');
    }
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('decision_saved');
  });

  it('[B-04c] SKILL.md 含 pending_user 协议标记', () => {
    if (!existsSync(SKILL_PATH)) {
      throw new Error('SKILL.md 不存在，D1 未实现');
    }
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('pending_user');
  });

  it('[B-04d] SKILL.md 含 turn_marker 或 [TURN:] 协议标记', () => {
    if (!existsSync(SKILL_PATH)) {
      throw new Error('SKILL.md 不存在，D1 未实现');
    }
    const content = readFileSync(SKILL_PATH, 'utf-8');
    // turn_marker 或 [TURN: 均可（PRD 要求"每轮必落 turn_marker"）
    expect(content.includes('turn_marker') || content.includes('[TURN:')).toBe(true);
  });

  it('[B-04e] SKILL.md 含用户确认→落库 decisions 的规程描述', () => {
    if (!existsSync(SKILL_PATH)) {
      throw new Error('SKILL.md 不存在，D1 未实现');
    }
    const content = readFileSync(SKILL_PATH, 'utf-8');
    // 规程要求：用户显式确认→POST decisions
    expect(content).toMatch(/decisions|POST.*decisions|落库/);
  });
});
