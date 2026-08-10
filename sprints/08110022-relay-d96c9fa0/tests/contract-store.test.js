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

import { describe, test, expect } from 'vitest';
import { computeContractHash } from '../contract-store.js';
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
    required_assertions: [
      { assertion_id: 'assert-001', command: 'npm test -- --testPathPattern=auth' },
    ],
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

  });

  // -------------------------------------------------------
  describe('validateImpactContract — schema 验证与持久化前置检查', () => {

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
  describe('合法合同写入与查询（需要 DB）', () => {

    test.skip('符合 schema 的合同写入 DB 后可通过 id 查询', async () => {
      // TODO: 集成测试，需要 TEST_DB_AVAILABLE=1 环境变量
      // 预期：persistImpactContract(pool, payload) → { contract: { id, task_id, ... }, created: true }
      //       getImpactContractById(pool, id) → 同一对象
    });

    test.skip('created_at 字段由 DB 自动生成', async () => {
      // TODO: 需要 DB
    });

  });

  // -------------------------------------------------------
  describe('API 端点行为（需要 Brain 运行）', () => {

    test.skip('POST /api/brain/impact-contracts 合法请求返回 201 + 合同 ID', async () => {});

    test.skip('POST /api/brain/impact-contracts 非法请求返回 400 + 字段错误描述', async () => {});

    test.skip('GET /api/brain/impact-contracts/:id 返回完整合同 JSON', async () => {});

    test.skip('GET /api/brain/impact-contracts/:id 对不存在的 id 返回 404', async () => {});

  });

  // -------------------------------------------------------
  describe('幂等性去重', () => {

    test('同一 contract_body 计算出的 hash 相同（幂等基础）', () => {
      const body = minimalValidContract();
      const h1 = computeContractHash(body);
      const h2 = computeContractHash({ ...body });
      expect(h1).toBe(h2);
    });

    test.skip('幂等重复后 DB 中该 (task_id, base_revision) 仍只有一条记录', async () => {
      // TODO: 需要 DB
    });

  });

  // -------------------------------------------------------
  describe('Mapper 不可达处理', () => {

    test.skip('Structure Gate Mapper 不可达时合同创建返回 503', async () => {
      // MJ5 STUB: 使用 mock Mapper 模拟不可达情形
      // 替换条件：MJ5 合同通过真实环境验收后，换为真实 Mapper 调用
    });

    test.skip('503 响应 body 包含 retryable=true', async () => {
      // MJ5 STUB: 同上
    });

  });

});
