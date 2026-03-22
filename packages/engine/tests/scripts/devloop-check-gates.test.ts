import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 门禁条件（subagent 架构）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('spec_review / code_review_gate 改为 Agent subagent（旧 Codex 路径已删除）', () => {
    it('不再包含 spec_review_task_id（已删除 Codex async 路径）', () => {
      expect(content).not.toContain('spec_review_task_id');
    });

    it('不再包含 _check_codex_review 函数（已删除）', () => {
      expect(content).not.toContain('_check_codex_review');
    });

    it('不再包含 code_review_gate_task_id（已删除 Codex async 路径）', () => {
      expect(content).not.toContain('code_review_gate_task_id');
    });

    it('注释中说明 spec_review 由 Agent subagent 同步完成', () => {
      expect(content).toContain('spec_review');
      expect(content).toContain('subagent');
    });
  });

  describe('4-Stage Pipeline 条件完整性', () => {
    it('包含条件 1: step_1_spec 检查', () => {
      expect(content).toContain('条件 1: step_1_spec');
    });

    it('包含条件 2: step_2_code 检查', () => {
      expect(content).toContain('条件 2: step_2_code');
    });

    it('step_1_spec 检查在 step_2_code 检查之前', () => {
      const s1Pos = content.indexOf('条件 1: step_1_spec');
      const s2Pos = content.indexOf('条件 2: step_2_code');
      expect(s1Pos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(s2Pos);
    });

    it('step_2_code 检查在 PR 检查之前', () => {
      const s2Pos = content.indexOf('条件 2: step_2_code');
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

    it('兼容旧字段名 step_4_learning', () => {
      expect(content).toContain('step_4_learning');
    });
  });
});
