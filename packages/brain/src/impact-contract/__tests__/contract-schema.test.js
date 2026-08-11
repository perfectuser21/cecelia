/**
 * FR-2 Impact Contract Schema（Zod）测试
 * 覆盖：合法合同通过验证、非法合同被拒绝、必填字段完整性
 *
 * 文件路径：packages/brain/src/impact-contract/contract-schema.js
 * sprint: 08110022-relay-d96c9fa0 ws2
 */

import { describe, test, expect } from 'vitest';
import { ImpactContractSchema, validateImpactContract, parseImpactContract } from '../contract-schema.js';
import { assertionDigest } from '../../lib/journey-assertion-receipt.js';

const ASSERTION_REF = 'packages/brain/src/impact-contract/__tests__/contract-schema.test.js';

// ---------- 合法合同 fixture ----------

/** 包含所有必填字段的最小合法合同 */
function minimalValidContract(overrides = {}) {
  return {
    task_id: '550e8400-e29b-41d4-a716-446655440000',
    change_kind: 'bugfix',
    base_revision: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    affected_capabilities: [
      { capability_id: 'cap-001', capability_name: 'user-auth', impact_level: 'direct' },
    ],
    required_assertions: [
      {
        assertion_id: ASSERTION_REF,
        command: `npx vitest run ${ASSERTION_REF}`,
        covers_capability_ids: ['cap-001'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1,
        assertion_digest: assertionDigest(ASSERTION_REF),
      },
    ],
    ...overrides,
  };
}

// ============================================================
describe('FR-2 Impact Contract Schema', () => {

  // -------------------------------------------------------
  describe('合法合同通过 schema 验证', () => {

    test('包含所有必填字段的合同通过 Zod parse 不抛出异常', () => {
      const data = minimalValidContract();
      expect(() => parseImpactContract(data)).not.toThrow();
    });

    test('change_kind 为四档之一时合同有效', () => {
      const kinds = ['new_capability', 'capability_change', 'bugfix', 'parameter_only'];
      for (const kind of kinds) {
        const result = validateImpactContract(minimalValidContract({ change_kind: kind }));
        expect(result.success).toBe(true);
      }
    });

    test('affected_capabilities 为非空数组时合同有效', () => {
      const data = minimalValidContract({
        affected_capabilities: [
          { capability_id: 'cap-001' },
          { capability_id: 'cap-002', impact_level: 'indirect' },
        ],
      });
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
    });

    test('inapplicable_items 为空数组时合同有效', () => {
      const data = minimalValidContract({ inapplicable_items: [] });
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
    });

    test('freshness_evidence 为 null 时合同有效（MJ5 stub 期间可为 null）', () => {
      const data = minimalValidContract({ freshness_evidence: null });
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
    });

    test('freshness_evidence 不传时合同有效（字段可选）', () => {
      const data = minimalValidContract();
      // minimalValidContract 未包含 freshness_evidence，应可通过
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
    });

    test('required_assertions 为空数组时合同有效', () => {
      const data = minimalValidContract({ required_assertions: [] });
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
    });

    test('parse 后 schema_version 有默认值 1', () => {
      const data = minimalValidContract();
      const parsed = parseImpactContract(data);
      expect(parsed.schema_version).toBe(1);
    });

    test('parse 后 inapplicable_items 默认为空数组', () => {
      const data = minimalValidContract();
      const parsed = parseImpactContract(data);
      expect(parsed.inapplicable_items).toEqual([]);
    });

  });

  // -------------------------------------------------------
  describe('非法合同被 schema 拒绝', () => {

    test('调用方不能把任意 shell command 声明成可信断言', () => {
      const data = minimalValidContract();
      data.required_assertions[0].command = 'true';
      expect(validateImpactContract(data).success).toBe(false);
    });

    test('非空断言缺少 capability 覆盖与不可变 Journey 绑定时无效', () => {
      const data = minimalValidContract({
        required_assertions: [{ assertion_id: 'assert-loose', command: 'npm test' }],
      });
      expect(validateImpactContract(data).success).toBe(false);
    });

    test('缺少 task_id 时 Zod parse 抛出 ZodError', () => {
      const data = minimalValidContract();
      delete data.task_id;
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('缺少 base_revision 时 Zod parse 抛出 ZodError', () => {
      const data = minimalValidContract();
      delete data.base_revision;
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('change_kind 为无效枚举值时 Zod parse 抛出 ZodError', () => {
      const data = minimalValidContract({ change_kind: 'invalid' });
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('affected_capabilities 为空数组时 Zod parse 抛出 ZodError', () => {
      const data = minimalValidContract({ affected_capabilities: [] });
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('required_assertions 缺失时 Zod parse 抛出 ZodError', () => {
      const data = minimalValidContract();
      delete data.required_assertions;
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('task_id 为空字符串时抛出 ZodError', () => {
      const data = minimalValidContract({ task_id: '' });
      let caughtErr;
      try { parseImpactContract(data); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.constructor.name).toBe('ZodError');
    });

    test('task_id 不是 UUID 时验证失败', () => {
      const result = validateImpactContract(minimalValidContract({ task_id: 'task-123' }));
      expect(result.success).toBe(false);
    });

    test('base_revision 不是 40 位 Git SHA 时验证失败', () => {
      const result = validateImpactContract(minimalValidContract({ base_revision: 'abc123' }));
      expect(result.success).toBe(false);
    });

  });

  // -------------------------------------------------------
  describe('schema 错误信息可读性', () => {

    test('ZodError.issues 包含缺失字段的路径信息', () => {
      const data = minimalValidContract();
      delete data.task_id;
      delete data.base_revision;

      const result = validateImpactContract(data);
      expect(result.success).toBe(false);

      // Zod 4.x 使用 .issues（不是 .errors）
      const issues = result.error.issues;
      expect(Array.isArray(issues)).toBeTruthy();
      const paths = issues.map((e) => (Array.isArray(e.path) ? e.path.join('.') : ''));
      expect(paths.some((p) => p === 'task_id' || p.includes('task_id'))).toBeTruthy();
    });

    test('validateImpactContract 返回 { success, error } 结构', () => {
      const invalid = { change_kind: 'bugfix' };
      const result = validateImpactContract(invalid);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      // Zod 4.x ZodError 使用 .issues
      expect(Array.isArray(result.error.issues)).toBeTruthy();
    });

    test('validateImpactContract 合法时返回 { success: true, data }', () => {
      const data = minimalValidContract();
      const result = validateImpactContract(data);
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data.task_id).toBe(data.task_id);
    });

  });

});
