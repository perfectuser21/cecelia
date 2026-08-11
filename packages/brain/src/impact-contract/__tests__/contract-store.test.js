/**
 * FR-2 Impact Contract 持久化测试
 * 覆盖：Schema 验证、computeContractHash 幂等性、persistImpactContract 逻辑
 *
 * 注意：DB 相关测试（createContract/getContract）需要运行中的 PostgreSQL，
 * 在 CI 无 DB 环境下标记为 skip。纯逻辑测试（hash 计算、schema 验证）无需 DB。
 *
 * 文件路径：packages/brain/src/impact-contract/contract-store.js
 * sprint: 08110022-relay-d96c9fa0 ws2
 */

import { describe, test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { computeContractHash, persistImpactContract } from '../contract-store.js';
import { validateImpactContract } from '../contract-schema.js';

// ---------- 合法合同 fixture ----------

function minimalValidContract(overrides = {}) {
  return {
    task_id: '550e8400-e29b-41d4-a716-446655440000',
    change_kind: 'bugfix',
    base_revision: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    affected_capabilities: [
      { capability_id: 'cap-001', capability_name: 'user-auth', impact_level: 'direct' },
    ],
    required_assertions: [],
    ...overrides,
  };
}

// ============================================================
describe('FR-2 Impact Contract 持久化', () => {

  // -------------------------------------------------------
  describe('computeContractHash — 哈希计算', () => {

    test('相同内容计算出相同 hash', () => {
      const body = minimalValidContract();
      const h1 = computeContractHash(body);
      const h2 = computeContractHash(body);
      expect(h1).toBe(h2);
    });

    test('不同内容计算出不同 hash', () => {
      const body1 = minimalValidContract({ base_revision: 'aaa000' });
      const body2 = minimalValidContract({ base_revision: 'bbb111' });
      const h1 = computeContractHash(body1);
      const h2 = computeContractHash(body2);
      expect(h1).not.toBe(h2);
    });

    test('hash 是有效的 hex 字符串（64 位 sha256）', () => {
      const body = minimalValidContract();
      const h = computeContractHash(body);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    test('字段顺序不影响 hash（规范化处理）', () => {
      const body1 = minimalValidContract();
      // 颠倒字段顺序构造另一个对象
      const body2 = Object.fromEntries(Object.entries(body1).reverse());
      const h1 = computeContractHash(body1);
      const h2 = computeContractHash(body2);
      expect(h1).toBe(h2);
    });

    test('嵌套 Capability 或断言变化必须改变 hash', () => {
      const body1 = minimalValidContract();
      const body2 = minimalValidContract({
        affected_capabilities: [
          { capability_id: 'cap-002', capability_name: 'billing', impact_level: 'direct' },
        ],
      });
      expect(computeContractHash(body1)).not.toBe(computeContractHash(body2));
    });

    test('freshness checked_at 不进入稳定语义 hash', () => {
      const first = minimalValidContract({
        freshness_evidence: { status: 'fresh', checked_at: '2026-08-11T00:00:00Z' },
      });
      const second = minimalValidContract({
        freshness_evidence: { status: 'fresh', checked_at: '2026-08-11T00:01:00Z' },
      });
      expect(computeContractHash(first)).toBe(computeContractHash(second));
    });

  });

  // -------------------------------------------------------
  describe('validateImpactContract — schema 验证与持久化前置检查', () => {

    test('持久化层拒绝未由 assertion_id 机械派生的 command', async () => {
      const contractBody = minimalValidContract({
        required_assertions: [{
          assertion_id: 'packages/brain/src/example.test.js', command: 'true',
          covers_capability_ids: ['cap-001'],
          journey_step_link_id: '11111111-1111-4111-8111-111111111111',
          assertion_revision: 1, assertion_digest: 'a'.repeat(64),
        }],
      });
      await expect(persistImpactContract({ query: vi.fn() }, {
        task_id: contractBody.task_id,
        change_kind: contractBody.change_kind,
        base_revision: contractBody.base_revision,
        manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
        contract_body: contractBody,
      })).rejects.toMatchObject({ code: 'impact_contract_schema_invalid' });
    });

    test('符合 schema 的合同验证通过', () => {
      const payload = minimalValidContract();
      const result = validateImpactContract(payload);
      expect(result.success).toBe(true);
    });

    test('写入的合同包含所有必填字段且类型正确', () => {
      const payload = minimalValidContract();
      const result = validateImpactContract(payload);
      expect(result.success).toBe(true);
      const data = result.data;
      expect(typeof data.task_id).toBe('string');
      expect(typeof data.change_kind).toBe('string');
      expect(typeof data.base_revision).toBe('string');
      expect(Array.isArray(data.affected_capabilities)).toBeTruthy();
      expect(Array.isArray(data.required_assertions)).toBeTruthy();
    });

    test('缺少 base_revision 时验证失败', () => {
      const payload = minimalValidContract();
      delete payload.base_revision;
      const result = validateImpactContract(payload);
      expect(result.success).toBe(false);
    });

    test('缺少 affected_capabilities 时验证失败', () => {
      const payload = minimalValidContract();
      delete payload.affected_capabilities;
      const result = validateImpactContract(payload);
      expect(result.success).toBe(false);
    });

    test('缺少 required_assertions 时验证失败', () => {
      const payload = minimalValidContract();
      delete payload.required_assertions;
      const result = validateImpactContract(payload);
      expect(result.success).toBe(false);
    });

  });

  // -------------------------------------------------------
  describe('幂等性去重', () => {

    test('同一 contract_body 计算出的 hash 相同（幂等基础）', () => {
      const body = minimalValidContract();
      const h1 = computeContractHash(body);
      const h2 = computeContractHash({ ...body });
      expect(h1).toBe(h2);
    });

    test('历史 superseded hash 再次成为当前语义时创建新版本，不把旧版本冒充 active', async () => {
      const assertionId = 'packages/brain/src/impact-contract/__tests__/contract-store.test.js';
      const contractBody = minimalValidContract({
        required_assertions: [{
          assertion_id: assertionId,
          command: `npx vitest run ${assertionId}`,
          covers_capability_ids: ['cap-001'],
          journey_step_link_id: '11111111-1111-4111-8111-111111111111',
          assertion_revision: 1,
          assertion_digest: createHash('sha256').update(assertionId).digest('hex'),
        }],
      });
      const db = {
        query: vi.fn(async (sql) => {
          const s = String(sql);
          if (s.startsWith('SELECT id FROM tasks')) return { rows: [{ id: contractBody.task_id }] };
          if (s.includes('contract_hash = $2')) {
            return { rows: [{ id: 'old-contract', version: 1, status: 'superseded' }] };
          }
          if (s.includes('SELECT MAX(version)')) {
            return { rows: [{ max_version: 2, active_id: 'current-contract' }] };
          }
          if (s.includes('INSERT INTO harness_impact_contracts')) {
            return { rows: [{ id: 'reactivated-contract', version: 3, status: 'active' }] };
          }
          return { rows: [] };
        }),
      };

      const result = await persistImpactContract(db, {
        task_id: contractBody.task_id,
        change_kind: contractBody.change_kind,
        base_revision: contractBody.base_revision,
        manifest_digest: '1'.repeat(64),
        projection_digest: '2'.repeat(64),
        contract_body: contractBody,
      });

      expect(result.created).toBe(true);
      expect(result.contract).toMatchObject({ version: 3, status: 'active' });
    });

  });

  // -------------------------------------------------------
  describe('Mapper 不可达处理', () => {

    test('持久层拒绝受影响 Capability 没有可执行断言覆盖的 active 合同', async () => {
      const db = { query: vi.fn() };
      const contractBody = minimalValidContract({ required_assertions: [] });
      await expect(persistImpactContract(db, {
        task_id: contractBody.task_id,
        change_kind: contractBody.change_kind,
        base_revision: contractBody.base_revision,
        manifest_digest: '1'.repeat(64),
        projection_digest: '2'.repeat(64),
        contract_body: contractBody,
      })).rejects.toMatchObject({ code: 'impact_assertion_authority_invalid' });
      expect(db.query).not.toHaveBeenCalled();
    });

    test('持久层拒绝绕开 Structure API 写入 schema 非法的 active 合同', async () => {
      const db = { query: vi.fn() };
      await expect(persistImpactContract(db, {
        task_id: minimalValidContract().task_id,
        change_kind: 'bugfix',
        base_revision: minimalValidContract().base_revision,
        manifest_digest: '1'.repeat(64),
        projection_digest: '2'.repeat(64),
        contract_body: minimalValidContract({ affected_capabilities: [] }),
      })).rejects.toMatchObject({ code: 'impact_contract_schema_invalid' });
      expect(db.query).not.toHaveBeenCalled();
    });

    test('缺少 Mapper digest 时持久层拒绝创建 active 合同', async () => {
      const db = { query: vi.fn() };
      await expect(persistImpactContract(db, {
        task_id: minimalValidContract().task_id,
        change_kind: 'bugfix',
        base_revision: minimalValidContract().base_revision,
        contract_body: minimalValidContract(),
      })).rejects.toMatchObject({ code: 'mapper_evidence_missing' });
      expect(db.query).not.toHaveBeenCalled();
    });

    test('非 64 位十六进制 Mapper digest 被拒绝', async () => {
      const db = { query: vi.fn() };
      await expect(persistImpactContract(db, {
        task_id: minimalValidContract().task_id,
        change_kind: 'bugfix',
        base_revision: minimalValidContract().base_revision,
        manifest_digest: 'short',
        projection_digest: '2'.repeat(64),
        contract_body: minimalValidContract(),
      })).rejects.toMatchObject({ code: 'mapper_evidence_invalid' });
      expect(db.query).not.toHaveBeenCalled();
    });

  });

});
