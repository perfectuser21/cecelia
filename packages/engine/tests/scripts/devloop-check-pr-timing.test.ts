import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 条件顺序', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  // 使用 ===== 分隔符定位，确保匹配实现代码而非头部注释
  const COND1  = '===== 条件 1: step_1_spec';
  const COND15 = '===== 条件 1.5: spec_review_status';
  const COND2  = '===== 条件 2: step_2_code';
  const COND25 = '===== 条件 2.5: code_review_gate_status';
  const COND3  = '===== 条件 3: PR';
  const COND4  = '===== 条件 4: CI';

  describe('条件顺序验证（subagent 架构，含 1.5/2.5 gate）', () => {
    it('step_1_spec（条件 1）在 step_2_code（条件 2）之前', () => {
      const s1Pos = content.indexOf(COND1);
      const s2Pos = content.indexOf(COND2);
      expect(s1Pos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(s2Pos);
    });

    it('spec_review_status gate（条件 1.5）在 step_1_spec 之后、step_2_code 之前', () => {
      const s1Pos = content.indexOf(COND1);
      const gate15Pos = content.indexOf(COND15);
      const s2Pos = content.indexOf(COND2);
      expect(s1Pos).toBeGreaterThan(-1);
      expect(gate15Pos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(gate15Pos);
      expect(gate15Pos).toBeLessThan(s2Pos);
    });

    it('step_2_code（条件 2）在 PR（条件 3）之前', () => {
      const s2Pos = content.indexOf(COND2);
      const prPos = content.indexOf(COND3);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(prPos).toBeGreaterThan(-1);
      expect(s2Pos).toBeLessThan(prPos);
    });

    it('code_review_gate_status gate（条件 2.5）在 step_2_code 之后、PR 之前', () => {
      const s2Pos = content.indexOf(COND2);
      const gate25Pos = content.indexOf(COND25);
      const prPos = content.indexOf(COND3);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(gate25Pos).toBeGreaterThan(-1);
      expect(prPos).toBeGreaterThan(-1);
      expect(s2Pos).toBeLessThan(gate25Pos);
      expect(gate25Pos).toBeLessThan(prPos);
    });

    it('PR 创建（条件 3）在 CI（条件 4）之前', () => {
      const prPos = content.indexOf(COND3);
      const ciPos = content.indexOf(COND4);
      expect(prPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(prPos).toBeLessThan(ciPos);
    });

    it('包含条件 1.5（spec_review_status subagent gate）', () => {
      expect(content).toContain(COND15);
    });

    it('包含条件 2.5（code_review_gate_status subagent gate）', () => {
      expect(content).toContain(COND25);
    });
  });

  describe('PR 创建消息正确', () => {
    it('PR 未创建时提示创建 PR', () => {
      expect(content).toContain('PR 未创建');
    });
  });
});
