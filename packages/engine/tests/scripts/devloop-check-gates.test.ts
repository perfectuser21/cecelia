import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 门禁条件', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件 1.5: spec_review 门禁（Stage 1 后）', () => {
    it('包含 spec_review_task_id 检查逻辑', () => {
      expect(content).toContain('spec_review_task_id');
    });

    it('包含 spec_review_status 状态检查', () => {
      expect(content).toContain('spec_review_status');
    });

    it('PASS 时更新 .dev-mode 状态', () => {
      expect(content).toContain('spec_review_status');
      // 通用审查函数 _check_codex_review 处理 PASS 更新
      expect(content).toContain('_check_codex_review');
    });
  });

  describe('条件 5: code_review 门禁（CI 通过后）', () => {
    it('包含 code_review_gate_task_id 检查逻辑', () => {
      expect(content).toContain('code_review_gate_task_id');
    });

    it('包含 code_review_gate_status 状态检查', () => {
      expect(content).toContain('code_review_gate_status');
    });

    it('code_review 检查在 CI 检查之后', () => {
      const ciPos = content.indexOf('条件 4: CI');
      const crPos = content.indexOf('条件 5: code_review');
      expect(ciPos).toBeGreaterThan(-1);
      expect(crPos).toBeGreaterThan(-1);
      expect(crPos).toBeGreaterThan(ciPos);
    });
  });

  describe('条件顺序: 4-Stage Pipeline', () => {
    it('step_1_spec 检查在 spec_review 之前', () => {
      const s1Pos = content.indexOf('step_1_spec');
      const srPos = content.indexOf('spec_review_task_id');
      expect(s1Pos).toBeGreaterThan(-1);
      expect(srPos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(srPos);
    });

    it('step_2_code 检查在 PR 检查之前', () => {
      const s2Pos = content.indexOf('step_2_code');
      const prPos = content.indexOf('条件 3: PR');
      expect(s2Pos).toBeGreaterThan(-1);
      expect(prPos).toBeGreaterThan(-1);
      expect(s2Pos).toBeLessThan(prPos);
    });
  });

  describe('与现有机制兼容', () => {
    it('保留 cleanup_done 终止条件', () => {
      expect(content).toContain('cleanup_done: true');
    });

    it('包含通用 _check_codex_review 函数', () => {
      expect(content).toContain('_check_codex_review');
    });

    it('兼容旧字段名 step_4_learning', () => {
      expect(content).toContain('step_4_learning');
    });
  });
});
