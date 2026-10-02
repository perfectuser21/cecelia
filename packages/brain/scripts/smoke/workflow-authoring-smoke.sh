#!/usr/bin/env bash
# 只读部署探针；不创建任务、不登记 workflow。写入 smoke 才使用 smoke-production-guard.mjs。
# 可选 WORKFLOW_AUTHORING_TASK_ID：回读已成功管理任务及其真实 workflow 登记。
set -euo pipefail
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = new URL(process.env.BRAIN_URL || 'http://localhost:5221');
assert.ok(['http:', 'https:'].includes(base.protocol), 'Brain URL 必须使用 HTTP(S)');
assert.ok(!base.username && !base.password, '凭据不得放入 URL');
const headers = process.env.CECELIA_INTERNAL_TOKEN
  ? { Authorization: `Bearer ${process.env.CECELIA_INTERNAL_TOKEN}` } : {};
async function read(path, expected = 200) {
  const res = await fetch(new URL(path, base), { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.ok(![401, 403, 503].includes(res.status), `接口鉴权或服务配置失败 HTTP ${res.status}`);
  assert.equal(res.status, expected, `只读探针 HTTP ${res.status}，预期 ${expected}`);
  try { return await res.json(); }
  catch { throw new Error('接口未返回 JSON，不能把代理层 404 当作服务就绪'); }
}
try {
  const missing = await read(`/api/brain/workflow-authoring/runs/${randomUUID()}`, 404);
  assert.equal(missing.error, 'WORKFLOW_AUTHORING_INVALID', '必须命中 authoring 业务路由');
  assert.equal(missing.message, '任务不存在', '必须确认真实任务查询已运行');
  const taskId = process.env.WORKFLOW_AUTHORING_TASK_ID;
  if (!taskId) {
    console.info('workflow-authoring 路由与鉴权探针通过；未提供任务 ID，未验收六活动业务完成。');
  } else {
    assert.match(taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const state = await read(`/api/brain/workflow-authoring/runs/${taskId}`);
    assert.equal(state.stage, 'completed', '六活动尚未完成');
    assert.equal(state.revision, 6, '必须推进六次');
    const stages = ['intake', 'reuse', 'compose', 'build', 'verify', 'register'];
    assert.deepEqual(state.receipts.map(receipt => receipt.stage), stages, '六活动回执必须齐全且有序');
    for (const receipt of state.receipts) {
      assert.ok(receipt.submission_id && receipt.actor && receipt.created_at, '回执缺少提交身份或时间');
      assert.match(receipt.input_sha256, /^[0-9a-f]{64}$/);
    }
    const registered = state.outputs.register;
    assert.equal(registered.readback_verified, true);
    assert.equal(registered.task_id, taskId);
    assert.equal(registered.definition_sha256, state.outputs.compose.definition_sha256);
    // 当前只有清单接口，没有 GET /workflows/:id；按能力筛选再精确匹配 ID。
    const catalog = await read(`/api/brain/workflows?capability_id=${encodeURIComponent(state.outputs.intake.capability_id)}`);
    assert.ok(Array.isArray(catalog.workflows), 'workflow 清单返回结构错误');
    const workflow = catalog.workflows.find(row => row.id === registered.workflow_id);
    assert.ok(workflow, '登记回执中的 workflow 不存在于真实目录');
    assert.equal(workflow.key, registered.key);
    assert.equal(workflow.version, registered.version);
    assert.equal(workflow.status, 'active');
    console.info('workflow-authoring 六活动回执与真实 workflow 目录回读通过。');
  }
} catch (error) {
  console.error(`workflow-authoring smoke 失败：${error.message}`);
  process.exitCode = 1;
}
JS
