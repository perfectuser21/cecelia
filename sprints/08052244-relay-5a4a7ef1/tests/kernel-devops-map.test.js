/**
 * TDD 测试：验证 Kernel DevOps 格子存在性
 *
 * 运行方式：node --test sprints/08052244-relay-5a4a7ef1/tests/kernel-devops-map.test.js
 *
 * 初始运行（格子未创建时）：Red（测试失败）
 * 实现后（格子已创建时）：Green（测试通过）
 *
 * 依赖：Node.js >= 18（内置 fetch + node:test）
 * 不依赖：vitest / jest / 任何外部测试框架
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const JOURNEY_ID = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';

/**
 * 工具函数：带超时的 fetch
 */
async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

describe('Kernel DevOps 格子账本 — sprint 08052244-relay-5a4a7ef1', () => {

  /**
   * B-1: journey_step kernel-contract-a20 在 journey e6f803f2 中存在
   *
   * 合同断言：GET /journey_steps?journey_id=... 返回列表中，
   * 存在至少 1 条 name 含 "kernel" 的记录
   */
  test('B-1: kernel-contract-a20 步骤存在', async () => {
    const steps = await fetchJSON(
      `${BRAIN}/api/brain/journey_steps?journey_id=${JOURNEY_ID}`
    );

    assert.ok(Array.isArray(steps), '响应应为数组');

    const kernelSteps = steps.filter(s =>
      s.name && /kernel/i.test(s.name)
    );

    assert.ok(
      kernelSteps.length >= 1,
      `期望 ≥1 个 kernel 步骤，实际找到 ${kernelSteps.length} 个。` +
      `当前步骤: [${steps.map(s => s.name).join(', ')}]`
    );

    // 额外验证：步骤名称精确包含 kernel-contract-a20
    const exactStep = kernelSteps.find(s => /kernel-contract-a20/i.test(s.name));
    assert.ok(
      exactStep,
      `期望找到名为 kernel-contract-a20 的步骤，实际 kernel 步骤: [${kernelSteps.map(s => s.name).join(', ')}]`
    );
  });

  /**
   * B-2: journey_step_links 中存在 artifact-verification 能力格子
   *
   * 合同断言：GET /journey_step_links?cells=1&cell_kind=capability 返回列表中，
   * 存在 cell_key 含 "artifact" 且 cell_kind='capability' 的记录
   */
  test('B-2: artifact-verification 能力格子存在（cell_kind=capability，cell_status=gray）', async () => {
    const cells = await fetchJSON(
      `${BRAIN}/api/brain/journey_step_links?journey_id=${JOURNEY_ID}&cells=1&cell_kind=capability&limit=500`
    );

    assert.ok(Array.isArray(cells), '响应应为数组');

    const artifactCells = cells.filter(c =>
      c.cell_key && /artifact/i.test(c.cell_key)
    );

    assert.ok(
      artifactCells.length >= 1,
      `期望 ≥1 个 artifact capability 格子，实际找到 ${artifactCells.length} 个。` +
      `当前 capability 格子 cell_key: [${cells.map(c => c.cell_key).join(', ')}]`
    );

    // 验证 cell_kind 正确
    for (const cell of artifactCells) {
      assert.equal(
        cell.cell_kind,
        'capability',
        `格子 ${cell.cell_key} 的 cell_kind 应为 capability，实际为 ${cell.cell_kind}`
      );
    }
  });

  /**
   * B-3: journey_step_links 中存在 A2-0 合同维度格子 ≥ 4 格
   *
   * 合同断言：GET /journey_step_links?cells=1 返回列表中，
   * cell_key 含 "a20" 的条目 ≥ 4，
   * 覆盖 capability/element/scenario 三种类型
   */
  test('B-3: A2-0 合同维度格子 ≥ 4 格存在（cell_key 含 a20）', async () => {
    const cells = await fetchJSON(
      `${BRAIN}/api/brain/journey_step_links?journey_id=${JOURNEY_ID}&cells=1&limit=500`
    );

    assert.ok(Array.isArray(cells), '响应应为数组');

    const a20Cells = cells.filter(c =>
      c.cell_key && /a20/i.test(c.cell_key)
    );

    assert.ok(
      a20Cells.length >= 4,
      `期望 ≥4 个 A2-0 格子，实际找到 ${a20Cells.length} 个。` +
      `A2-0 格子 cell_key: [${a20Cells.map(c => c.cell_key).join(', ')}]`
    );

    // 验证覆盖了 capability 和 element 两种类型
    const kinds = new Set(a20Cells.map(c => c.cell_kind));
    const EXPECTED_KINDS = ['capability', 'element', 'scenario'];
    const hasAtLeastTwoKinds = EXPECTED_KINDS.filter(k => kinds.has(k)).length >= 2;
    assert.ok(
      hasAtLeastTwoKinds,
      `A2-0 格子应涵盖 ≥2 种 cell_kind（capability/element/scenario），实际: [${[...kinds].join(', ')}]`
    );

    // 验证具体 4 个关键格子的 cell_key 存在
    const requiredKeys = [
      'a20-schema',
      'a20-proof',
      'a20-cutover-gate',
      'a20-draft-blockers',
    ];
    for (const key of requiredKeys) {
      const found = a20Cells.find(c => c.cell_key === key);
      assert.ok(
        found,
        `期望找到 cell_key='${key}' 的格子，当前 A2-0 格子: [${a20Cells.map(c => c.cell_key).join(', ')}]`
      );
    }
  });

  /**
   * B-4: 所有新写入格子（cell_key 含 a20 或 artifact）均为 gray，不存在 green
   *
   * 合同断言：PR #4457 proof_complete=false，无法提供 assertion_ref，
   * API fail-closed 规则禁止写入 green，所有格子必须保持 gray
   */
  test('B-4: 所有 a20/artifact 格子 cell_status=gray（禁止虚报 green）', async () => {
    const cells = await fetchJSON(
      `${BRAIN}/api/brain/journey_step_links?journey_id=${JOURNEY_ID}&cells=1&limit=500`
    );

    assert.ok(Array.isArray(cells), '响应应为数组');

    const targetCells = cells.filter(c =>
      c.cell_key && /a20|artifact/i.test(c.cell_key)
    );

    // 确认目标格子存在（避免空集误通过）
    assert.ok(
      targetCells.length >= 1,
      `B-4 前置：至少需要 1 个 a20/artifact 格子才能验证状态，当前为 0`
    );

    const greenCells = targetCells.filter(c => c.cell_status === 'green');
    assert.equal(
      greenCells.length,
      0,
      `发现 ${greenCells.length} 个 green 格子（应为 0）：[${greenCells.map(c => `${c.cell_key}=${c.cell_status}`).join(', ')}]`
    );

    // 所有格子应为 gray
    for (const cell of targetCells) {
      assert.equal(
        cell.cell_status,
        'gray',
        `格子 ${cell.cell_key} 的 cell_status 应为 gray，实际为 ${cell.cell_status}`
      );
    }
  });

});
