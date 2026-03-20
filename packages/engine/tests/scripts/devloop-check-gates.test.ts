import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 质量门禁条件', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件 2.7: dod_verify 门禁', () => {
    it('包含 dod_verify_task_id 检查逻辑', () => {
      expect(content).toContain('dod_verify_task_id');
    });

    it('包含 dod_verify_status 状态检查', () => {
      expect(content).toContain('dod_verify_status');
    });

    it('PASS 时更新 .dev-mode 状态', () => {
      expect(content).toContain('dod_verify_status: pass');
    });

    it('FAIL 时返回修复指引', () => {
      expect(content).toContain('DoD 独立验证未通过');
    });

    it('轮询 Brain API 查询任务状态', () => {
      // 检查 curl 调用 Brain API
      expect(content).toMatch(/curl.*brain_url_dv.*tasks.*dv_task_id/s);
    });
  });

  describe('条件 2.6: prd_coverage_audit 门禁', () => {
    it('包含 prd_audit_task_id 检查逻辑', () => {
      expect(content).toContain('prd_audit_task_id');
    });

    it('包含 prd_audit_status 状态检查', () => {
      expect(content).toContain('prd_audit_status');
    });

    it('PASS 时更新 .dev-mode 状态', () => {
      expect(content).toContain('prd_audit_status: pass');
    });

    it('FAIL 时返回 MISSING 项修复指引', () => {
      expect(content).toContain('PRD 覆盖审计未通过');
    });
  });

  describe('条件顺序: 所有审查在 CI 之前', () => {
    it('dod_verify 检查在 CI 检查之前', () => {
      const dvPos = content.indexOf('dod_verify_task_id');
      const ciPos = content.indexOf('条件 3: CI');
      expect(dvPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(dvPos).toBeLessThan(ciPos);
    });

    it('prd_audit 检查在 CI 检查之前', () => {
      const paPos = content.indexOf('prd_audit_task_id');
      const ciPos = content.indexOf('条件 3: CI');
      expect(paPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(paPos).toBeLessThan(ciPos);
    });

    it('条件编号正确: 2.5 cto_review → 2.6 prd_audit → 2.7 dod_verify → 3 CI', () => {
      expect(content).toContain('条件 2.5');
      expect(content).toContain('条件 2.6');
      expect(content).toContain('条件 2.7');
      expect(content).toContain('条件 3: CI');
    });
  });

  describe('与现有门禁兼容', () => {
    it('intent_expand 条件已移除', () => {
      expect(content).not.toContain('intent_expand_task_id');
    });

    it('保留 cto_review 条件 2.5', () => {
      expect(content).toContain('cto_review_task_id');
    });

    it('保留 PR review 条件', () => {
      expect(content).toContain('review_task_id');
    });

    it('保留 cleanup_done 终止条件', () => {
      expect(content).toContain('cleanup_done: true');
    });
  });
});
