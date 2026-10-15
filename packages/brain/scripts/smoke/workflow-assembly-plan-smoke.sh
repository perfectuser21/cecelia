#!/usr/bin/env bash
# 只读 HTTP 探针；可选 WORKFLOW_ASSEMBLY_TASK_ID 回读已有组装定义，不创建或执行任务。
set -euo pipefail
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = new URL(process.env.BRAIN_URL || 'http://localhost:5221');
assert.ok(['http:', 'https:'].includes(base.protocol), 'Brain URL 必须使用 HTTP(S)');
assert.ok(!base.username && !base.password, '凭据不得放入 URL');
const headers = { 'X-Tenant-Id': process.env.WORKFLOW_ASSEMBLY_TENANT_ID || 'default' };
if (process.env.CECELIA_INTERNAL_TOKEN) headers.Authorization = `Bearer ${process.env.CECELIA_INTERNAL_TOKEN}`;
async function read(taskId, expected) {
  const response = await fetch(new URL(`/api/brain/workflow-authoring/runs/${taskId}/assembly-plan`, base),
    { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, `装配入口 HTTP ${response.status}，预期 ${expected}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/, '不能把代理层响应当作业务入口');
  return response.json();
}
try {
  const missing = await read(randomUUID(), 404);
  assert.equal(missing.error, 'WORKFLOW_AUTHORING_INVALID');
  assert.equal(missing.message, '任务不存在', '必须命中新装配路由及真实任务读取');
  const taskId = process.env.WORKFLOW_ASSEMBLY_TASK_ID;
  if (taskId) {
    assert.match(taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const result = await read(taskId, 200), repeated = await read(taskId, 200);
    assert.equal(result.task_id, taskId);
    assert.equal(result.plan.protocol, 'workflow-assembly-plan-v1');
    assert.equal(result.plan.tenant_id, headers['X-Tenant-Id']);
    assert.equal(result.plan.callable, false, '静态计划不能授予调用资格');
    assert.ok(['blocked', 'unverified'].includes(result.plan.readiness));
    assert.match(result.plan.definition_sha256, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(result.plan.activities) && Array.isArray(result.plan.gaps));
    for (const code of ['implementation_reference_unverified', 'runtime_admission_unverified', 'execution_evidence_unverified']) {
      assert.ok(result.plan.gaps.some(gap => gap.code === code), `缺少静态验证边界 ${code}`);
    }
    assert.deepEqual(repeated, result, '相同保存定义的只读计划必须稳定');
    console.info(`装配计划真实回读通过：readiness=${result.plan.readiness}，callable=false。`);
  } else {
    console.info('装配入口及真实任务查询通过；未提供已有任务 ID，未验收业务装配或执行。');
  }
} catch (error) {
  console.error(`workflow-assembly-plan smoke 失败：${error.message}`);
  process.exitCode = 1;
}
JS
