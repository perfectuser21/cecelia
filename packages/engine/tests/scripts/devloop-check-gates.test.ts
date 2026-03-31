import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');
const STOP_DEV = path.resolve(__dirname, '../../hooks/stop-dev.sh');

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

  describe('三阶段 seal 对齐检查（条件 1.6 / 2.8）', () => {
    it('包含条件 1.6: planner seal 文件验证', () => {
      expect(content).toContain('条件 1.6: planner seal');
    });

    it('包含条件 2.8: generator seal 文件验证', () => {
      expect(content).toContain('条件 2.8: generator seal');
    });

    it('条件 1.6 检查 .dev-gate-planner.{branch} 文件', () => {
      expect(content).toContain('dev-gate-planner.');
    });

    it('条件 2.8 检查 .dev-gate-generator.{branch} 文件', () => {
      expect(content).toContain('dev-gate-generator.');
    });

    it('条件 1.6 缺失时返回 blocked 含 planner', () => {
      const idx = content.indexOf('===== 条件 1.6: planner seal');
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 1300);
      expect(section).toContain('blocked');
      expect(section).toContain('planner');
    });

    it('条件 2.8 缺失时返回 blocked 含 generator', () => {
      const idx = content.indexOf('===== 条件 2.8: generator seal');
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 900);
      expect(section).toContain('blocked');
      expect(section).toContain('generator');
    });

    it('条件 1.6 位于条件 1.5 之后、条件 2 之前', () => {
      const cond15Pos = content.indexOf('===== 条件 1.5: spec_review_status');
      const cond16Pos = content.indexOf('===== 条件 1.6: planner seal');
      const cond2Pos  = content.indexOf('===== 条件 2: step_2_code');
      expect(cond15Pos).toBeGreaterThan(-1);
      expect(cond16Pos).toBeGreaterThan(cond15Pos);
      expect(cond2Pos).toBeGreaterThan(cond16Pos);
    });

    it('条件 2.8 位于条件 2.5 之后、条件 3 之前', () => {
      const cond25Pos = content.indexOf('===== 条件 2.5: code_review_gate_status');
      const cond28Pos = content.indexOf('===== 条件 2.8: generator seal');
      const cond3Pos  = content.indexOf('===== 条件 3: PR');
      expect(cond25Pos).toBeGreaterThan(-1);
      expect(cond28Pos).toBeGreaterThan(cond25Pos);
      expect(cond3Pos).toBeGreaterThan(cond28Pos);
    });
  });

  describe('return 码正确性：合并失败路径使用 return 2 而非 return 1', () => {
    it('devloop-check.sh 不含 return 1（所有路径返回 0 或 2）', () => {
      // 确保合并失败时使用 return 2（blocked），不使用 return 1（error）
      // 防止工作流因 return 1 被误判为脚本错误而终止
      expect(content).not.toMatch(/^\s*return 1\b/m);
    });

    it('devloop-check.sh 合并失败块包含 return 2', () => {
      // 合并失败块紧跟在 "合并失败" 日志之后，必须以 return 2 结尾
      const mergeFailIdx = content.indexOf('合并失败');
      expect(mergeFailIdx).toBeGreaterThan(-1);
      const section = content.substring(mergeFailIdx, mergeFailIdx + 500);
      expect(section).toContain('return 2');
    });
  });
});

describe('stop-dev.sh — 15min 超时自动 pass 降级机制', () => {
  const stopDevContent = fs.readFileSync(STOP_DEV, 'utf8');

  it('fallback 路径含 15min（900s）超时判断', () => {
    // 防止 Codex 审查永久阻塞：spec_review / code_review_gate 超过 900 秒自动 pass
    expect(stopDevContent).toContain('-gt 900');
  });

  it('15min 超时后自动将 spec_review_status 改为 pass', () => {
    const timeoutIdx = stopDevContent.indexOf('-gt 900');
    expect(timeoutIdx).toBeGreaterThan(-1);
    const section = stopDevContent.substring(timeoutIdx, timeoutIdx + 500);
    expect(section).toContain('spec_review_status: pass');
  });
});
