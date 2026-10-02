import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./workflow-authoring-smoke.sh', import.meta.url));
const taskId = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
const registered = { workflow_id: 'wf-1', key: 'example', version: '1.0.0', task_id: taskId,
  definition_sha256: digest, readback_verified: true };
const complete = () => ({ stage: 'completed', revision: 6,
  receipts: ['intake', 'reuse', 'compose', 'build', 'verify', 'register'].map(stage => ({
    stage, submission_id: stage, actor: 'test', created_at: new Date().toISOString(), input_sha256: digest,
  })), outputs: { intake: { capability_id: taskId }, compose: { definition_sha256: digest }, register: registered } });
async function run({ authStatus, missingBody, state, workflows } = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push([req.method, req.url, req.headers.authorization]);
    const isRun = req.url === `/api/brain/workflow-authoring/runs/${taskId}`;
    const isCatalog = req.url.startsWith('/api/brain/workflows?');
    const status = authStatus || (isRun || isCatalog ? 200 : 404);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(isRun ? state : isCatalog ? { workflows } : missingBody || {
      error: 'WORKFLOW_AUTHORING_INVALID', message: '任务不存在',
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn('bash', [script], { env: { ...process.env,
      BRAIN_URL: `http://127.0.0.1:${server.address().port}`, CECELIA_INTERNAL_TOKEN: 'smoke-test-token',
      WORKFLOW_AUTHORING_TASK_ID: state ? taskId : '',
    } });
    let output = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { output += value; });
    const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    return { code, output, calls };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

describe('workflow-authoring smoke 真实HTTP契约', () => {
  it('默认只读检查业务404，不宣称六活动已验收', async () => {
    const result = await run();
    expect(result.code, result.output).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0][0]).toBe('GET');
    expect(result.calls[0][2]).toBe('Bearer smoke-test-token');
    expect(result.output).toContain('未验收六活动业务完成');
  });
  it.each([401, 403, 503])('鉴权/配置HTTP %i 必须失败', async authStatus => {
    expect((await run({ authStatus })).code).not.toBe(0);
  });
  it('代理通用404不算业务路由通过', async () => {
    expect((await run({ missingBody: { error: 'not_found' } })).code).not.toBe(0);
  });
  it('提供任务时同时回读六回执与真实目录且仍只读', async () => {
    const result = await run({ state: complete(), workflows: [{ id: 'wf-1', key: 'example', version: '1.0.0', status: 'active' }] });
    expect(result.code, result.output).toBe(0);
    expect(result.calls).toHaveLength(3);
    expect(result.calls.every(([method]) => method === 'GET')).toBe(true);
  });
  it('任务已完成但目录无登记不能通过', async () => {
    expect((await run({ state: complete(), workflows: [] })).code).not.toBe(0);
  });
});
