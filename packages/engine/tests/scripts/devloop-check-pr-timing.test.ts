import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 条件顺序', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件顺序验证', () => {
    it('step_1_spec 检查在 spec_review 之前', () => {
      const s1Pos = content.indexOf('条件 1: step_1_spec');
      const srPos = content.indexOf('条件 1.5: spec_review');
      expect(s1Pos).toBeGreaterThan(-1);
      expect(srPos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(srPos);
    });

    it('spec_review（条件 1.5）在 step_2_code（条件 2）之前', () => {
      const srPos = content.indexOf('条件 1.5: spec_review');
      const s2Pos = content.indexOf('条件 2: step_2_code');
      expect(srPos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(srPos).toBeLessThan(s2Pos);
    });

    it('PR 创建（条件 3）在 CI（条件 4）之前', () => {
      const prPos = content.indexOf('条件 3: PR');
      const ciPos = content.indexOf('条件 4: CI');
      expect(prPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(prPos).toBeLessThan(ciPos);
    });

    it('code_review（条件 5）在 CI 之后', () => {
      const ciPos = content.indexOf('条件 4: CI');
      const crPos = content.indexOf('条件 5: code_review');
      expect(ciPos).toBeGreaterThan(-1);
      expect(crPos).toBeGreaterThan(-1);
      expect(crPos).toBeGreaterThan(ciPos);
    });
  });

  describe('PR 创建消息正确', () => {
    it('PR 未创建时提示创建 PR', () => {
      expect(content).toContain('PR 未创建');
    });
  });
});
