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

    it('包含条件 1.5: spec_review_status 检查', () => {
      expect(content).toContain('条件 1.5: spec_review_status');
    });

    it('包含条件 2: step_2_code 检查', () => {
      expect(content).toContain('条件 2: step_2_code');
    });

    it('包含条件 2.5: code_review_gate_status 检查', () => {
      expect(content).toContain('条件 2.5: code_review_gate_status');
    });

    // 使用 ===== 分隔符定位实现代码，避免匹配头部注释
    const COND15_IMPL = '===== 条件 1.5: spec_review_status';
    const COND25_IMPL = '===== 条件 2.5: code_review_gate_status';
    const COND1_IMPL  = '===== 条件 1: step_1_spec';
    const COND2_IMPL  = '===== 条件 2: step_2_code';
    const COND3_IMPL  = '===== 条件 3: PR';

    it('条件 1.5 包含 spec_review_status 与 pass 的比较逻辑', () => {
      const idx = content.indexOf(COND15_IMPL);
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 500);
      expect(section).toContain('spec_review_status');
      expect(section).toContain('pass');
    });

    it('条件 2.5 包含 code_review_gate_status 与 pass 的比较逻辑', () => {
      const idx = content.indexOf(COND25_IMPL);
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 500);
      expect(section).toContain('code_review_gate_status');
      expect(section).toContain('pass');
    });

    it('条件 1.5 blocked 时返回含 spec_review 的 blocked JSON', () => {
      const idx = content.indexOf(COND15_IMPL);
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 500);
      expect(section).toContain('blocked');
      expect(section).toContain('spec_review');
    });

    it('条件 2.5 blocked 时返回含 code_review_gate 的 blocked JSON', () => {
      const idx = content.indexOf(COND25_IMPL);
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 500);
      expect(section).toContain('blocked');
      expect(section).toContain('code_review_gate');
    });

    it('step_1_spec 检查在 step_2_code 检查之前', () => {
      const s1Pos = content.indexOf(COND1_IMPL);
      const s2Pos = content.indexOf(COND2_IMPL);
      expect(s1Pos).toBeGreaterThan(-1);
      expect(s2Pos).toBeGreaterThan(-1);
      expect(s1Pos).toBeLessThan(s2Pos);
    });

    it('step_2_code 检查在 PR 检查之前', () => {
      const s2Pos = content.indexOf(COND2_IMPL);
      const prPos = content.indexOf(COND3_IMPL);
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
