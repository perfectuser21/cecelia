import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 条件顺序', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件顺序验证（subagent 架构，无 1.5/2.5）', () => {
    it('step_1_spec（条件 1）在 step_2_code（条件 2）之前', () => {
      const s1Pos = content.indexOf('条件 1: step_1_spec');
      const s2Pos = content.indexOf('条件 2: step_2_code');
      expect(s1Pos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(s2Pos);
    });

    it('step_2_code（条件 2）在 PR（条件 3）之前', () => {
      const s2Pos = content.indexOf('条件 2: step_2_code');
      const prPos = content.indexOf('条件 3: PR');
      expect(s2Pos).toBeGreaterThan(-1);
      expect(prPos).toBeGreaterThan(-1);
      expect(s2Pos).toBeLessThan(prPos);
    });

    it('PR 创建（条件 3）在 CI（条件 4）之前', () => {
      const prPos = content.indexOf('条件 3: PR');
      const ciPos = content.indexOf('条件 4: CI');
      expect(prPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(prPos).toBeLessThan(ciPos);
    });

    it('不再有条件 1.5（spec_review Codex Gate 已删除）', () => {
      expect(content).not.toContain('条件 1.5');
    });

    it('不再有条件 2.5（code_review Codex Gate 已删除）', () => {
      expect(content).not.toContain('条件 2.5');
    });
  });

  describe('PR 创建消息正确', () => {
    it('PR 未创建时提示创建 PR', () => {
      expect(content).toContain('PR 未创建');
    });
  });
});
