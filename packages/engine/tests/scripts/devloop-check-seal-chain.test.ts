import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 三阶段 seal 对齐检查（Planner→Contract→Generator）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件 1.2: Planner seal 前置门禁（Sprint Contract 开始前）', () => {
    it('包含条件 1.2 注释标识', () => {
      expect(content).toContain('条件 1.2:');
    });

    it('检查 .dev-gate-planner.{branch} 文件是否存在', () => {
      expect(content).toContain('.dev-gate-planner.');
    });

    it('blocked 时 reason 包含 "Planner seal" 文字', () => {
      const idx = content.indexOf('条件 1.2:');
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 600);
      expect(section).toContain('Planner seal');
    });

    it('条件 1.2 在条件 1.5 之前（确保链路顺序）', () => {
      const pos12 = content.indexOf('条件 1.2:');
      const pos15 = content.indexOf('条件 1.5:');
      expect(pos12).toBeGreaterThan(-1);
      expect(pos15).toBeGreaterThan(-1);
      expect(pos12).toBeLessThan(pos15);
    });
  });

  describe('条件 1.8: spec seal 硬门禁（Generator 前置条件）', () => {
    it('包含条件 1.8 注释标识', () => {
      expect(content).toContain('条件 1.8:');
    });

    it('硬门禁检查 .dev-gate-spec.{branch} 文件是否存在', () => {
      const idx = content.indexOf('条件 1.8:');
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 600);
      expect(section).toContain('.dev-gate-spec.');
    });

    it('条件 1.8 在条件 1.5 之后、条件 2 之前（确保链路顺序）', () => {
      const pos15 = content.indexOf('条件 1.5:');
      const pos18 = content.indexOf('条件 1.8:');
      const pos2  = content.indexOf('条件 2: step_2_code');
      expect(pos15).toBeGreaterThan(-1);
      expect(pos18).toBeGreaterThan(-1);
      expect(pos2).toBeGreaterThan(-1);
      expect(pos15).toBeLessThan(pos18);
      expect(pos18).toBeLessThan(pos2);
    });
  });

  describe('条件 2.2: Generator seal 前置门禁（Stage 3 开始前）', () => {
    it('包含条件 2.2 注释标识', () => {
      expect(content).toContain('条件 2.2:');
    });

    it('检查 .dev-gate-generator.{branch} 文件是否存在', () => {
      expect(content).toContain('.dev-gate-generator.');
    });

    it('blocked 时 reason 包含 "Generator seal" 文字', () => {
      const idx = content.indexOf('条件 2.2:');
      expect(idx).toBeGreaterThan(-1);
      const section = content.substring(idx, idx + 600);
      expect(section).toContain('Generator seal');
    });

    it('条件 2.2 在条件 2 之后、条件 2.5 之前（确保链路顺序）', () => {
      const pos2   = content.indexOf('条件 2: step_2_code');
      const pos22  = content.indexOf('条件 2.2:');
      const pos25  = content.indexOf('条件 2.5:');
      expect(pos2).toBeGreaterThan(-1);
      expect(pos22).toBeGreaterThan(-1);
      expect(pos25).toBeGreaterThan(-1);
      expect(pos2).toBeLessThan(pos22);
      expect(pos22).toBeLessThan(pos25);
    });
  });

  describe('三阶段链路完整性（PRESERVE：现有条件 1.5 和 2.5 不变）', () => {
    it('条件 1.5 spec_review seal 逻辑仍存在', () => {
      expect(content).toContain('.dev-gate-spec.');
      expect(content).toContain('spec_review_status');
    });

    it('条件 2.5 code_review_gate seal 逻辑仍存在', () => {
      expect(content).toContain('.dev-gate-crg.');
      expect(content).toContain('code_review_gate_status');
    });

    it('seal 检查总数正确（planner/spec×2/generator/crg = 4 种 seal 文件）', () => {
      expect(content).toContain('.dev-gate-planner.');
      expect(content).toContain('.dev-gate-spec.');
      expect(content).toContain('.dev-gate-generator.');
      expect(content).toContain('.dev-gate-crg.');
    });
  });
});
