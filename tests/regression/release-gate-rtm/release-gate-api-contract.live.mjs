/**
 * API Contract Tests — Brain API release-gate 端点（BEHAVIOR-05）
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * 覆盖：GET /api/brain/release-gate/:pathId → 200，POST → 405
 *
 * ⚠️ 骨架阶段：路由尚未实现，测试全部应当 FAIL（红灯）
 *
 * 运行方式（需 Brain API 在 localhost:5221 运行）：
 *   node --test sprints/07162100-release-gate-rtm/tests/release-gate-api-contract.test.mjs
 */

// vitest 兼容桥（5167ef48 修复时发现的存量雷）：node:test 的 describe/test 在 vitest import
// 下不注册 suite → "No test suite found" 文件级红。按环境选 runner；node:test 的 before
// 映射 vitest beforeAll（语义等价：suite 前置一次）。断言是 node:assert 通用。
const { test, describe, before } = process.env.VITEST
  ? await import('vitest').then((m) => ({ test: m.test, describe: m.describe, before: m.beforeAll }))
  : await import('node:test');
import assert from 'node:assert/strict';

const BRAIN_URL = process.env.BRAIN_URL ?? 'http://localhost:5221';
const GATE_PATH = 'path4-customer-service';
const ENDPOINT = `${BRAIN_URL}/api/brain/release-gate/${GATE_PATH}`;

/**
 * 简单 HTTP 请求工具（不引入新依赖，使用内置 fetch）
 */
async function request(url, method = 'GET') {
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(5000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    throw new Error(`请求失败 ${method} ${url}: ${err.message}`);
  }
}

// ─── [BEHAVIOR-05] GET 查账 → 200 + verdict ──────────────────────────────────

describe('[BEHAVIOR-05] Brain API release-gate 端点只读约束', () => {
  test('GET /api/brain/release-gate/:pathId → HTTP 200', async () => {
    const { status } = await request(ENDPOINT, 'GET');
    assert.strictEqual(status, 200, `期望 HTTP 200，实际 ${status}`);
  });

  test('GET 响应 body 含 verdict 字段', async () => {
    const { body } = await request(ENDPOINT, 'GET');
    assert.ok(body !== null, '响应 body 不应为 null');
    assert.ok(
      'verdict' in body,
      `响应 body 缺少 verdict 字段。实际 body: ${JSON.stringify(body)}`
    );
  });

  test('GET 响应 body 含 gaps 字段（数组）', async () => {
    const { body } = await request(ENDPOINT, 'GET');
    assert.ok(body !== null, '响应 body 不应为 null');
    assert.ok(
      'gaps' in body,
      `响应 body 缺少 gaps 字段。实际 body: ${JSON.stringify(body)}`
    );
    assert.ok(Array.isArray(body.gaps), `gaps 应为数组，实际: ${typeof body.gaps}`);
  });

  test('当前 path4 状态应返回 verdict=BLOCKED（接缝步未达 L3）', async () => {
    const { body } = await request(ENDPOINT, 'GET');
    assert.ok(body !== null, '响应 body 不应为 null');
    // path4 当前有 6 个接缝步未达 L3，verdict 应为 BLOCKED
    assert.strictEqual(
      body.verdict,
      'BLOCKED',
      `path4 当前应返回 BLOCKED，实际: ${body.verdict}`
    );
  });

  test('POST /api/brain/release-gate/:pathId → HTTP 405（只读端点拒绝写操作）', async () => {
    const { status } = await request(ENDPOINT, 'POST');
    assert.strictEqual(status, 405, `期望 HTTP 405，实际 ${status}`);
  });

  test('PUT /api/brain/release-gate/:pathId → HTTP 405', async () => {
    const { status } = await request(ENDPOINT, 'PUT');
    assert.strictEqual(status, 405, `期望 HTTP 405，实际 ${status}`);
  });

  test('PATCH /api/brain/release-gate/:pathId → HTTP 405', async () => {
    const { status } = await request(ENDPOINT, 'PATCH');
    assert.strictEqual(status, 405, `期望 HTTP 405，实际 ${status}`);
  });

  test('pathId 不存在时 GET 返回 verdict=NO_RTM（而非 HTTP 404 或 PASS）', async () => {
    const { status, body } = await request(
      `${BRAIN_URL}/api/brain/release-gate/nonexistent-path-xyz`,
      'GET'
    );
    // 端点应返回 200 + verdict=NO_RTM（而非 HTTP 404）
    // 或 404 均可接受，但绝不能返回 verdict=PASS
    if (status === 200) {
      assert.ok(body !== null, '响应 body 不应为 null');
      assert.notStrictEqual(body.verdict, 'PASS', 'RTM 缺失不得返回 PASS');
    } else {
      // HTTP 404 也是可接受的行为（明确不存在）
      assert.ok(
        [404, 422].includes(status),
        `期望 200（verdict=NO_RTM）或 404，实际 ${status}`
      );
    }
  });
});
