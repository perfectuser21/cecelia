import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '../activities/report.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('report 活动（子进程 + 假 Brain）', () => {
  let server;
  let brainUrl;
  let requests;
  let reply;

  beforeEach(async () => {
    requests = [];
    reply = { status: 200, body: { id: TASK_ID } };
    server = http.createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, raw });
        res.statusCode = reply.status;
        res.setHeader('content-type', 'application/json');
        res.end(reply.raw ?? JSON.stringify(reply.body));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    brainUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    brain_url: brainUrl,
    pr_url: 'https://github.com/example/repo/pull/2',
    branch: 'cp-1007220300-coding-workflow',
    sprint_dir: 'sprints/s1',
    chain_files: ['01-intent.md', '02-spec.md'],
    ...patch,
  });

  it('成功：恰好一次 PATCH，body 只有 result.coding_workflow 且字段齐全、无 status', async () => {
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(0);
    expect(r.result.status).toBe('completed');
    expect(r.result.failure_class).toBeNull();
    expect(r.result.run_tag).toBe('rt-1');
    expect(r.result.outputs).toEqual({ reported: true });

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe('PATCH');
    expect(req.url).toBe(`/api/brain/tasks/${TASK_ID}`);
    expect(req.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(req.raw);
    expect(Object.keys(body)).toEqual(['result']);
    expect(Object.keys(body.result)).toEqual(['coding_workflow']);
    expect(body.result.coding_workflow).toEqual({
      pr_url: 'https://github.com/example/repo/pull/2',
      branch: 'cp-1007220300-coding-workflow',
      sprint_dir: 'sprints/s1',
      chain_files: ['01-intent.md', '02-spec.md'],
      run_tag: 'rt-1',
      host: os.hostname(),
    });
    expect('status' in body).toBe(false);
  });

  it('stdout 只有一个结果 JSON', async () => {
    const r = await runActivityProcess(ENTRY, input());
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('brain_url 末尾斜杠被规整，task_id 做 URL 编码', async () => {
    const r = await runActivityProcess(ENTRY, input({ brain_url: `${brainUrl}//`, task_id: 'a/b c' }));
    expect(r.exitCode).toBe(0);
    expect(requests[0].url).toBe('/api/brain/tasks/a%2Fb%20c');
  });

  it.each([404, 400])('Brain %i -> fatal task_not_found', async (status) => {
    reply = { status, body: { error: 'nope' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.status).toBe('failed');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_not_found');
  });

  it('失败结果 evidence 带 http_status 与响应体 code', async () => {
    reply = { status: 404, body: { code: 'task_gone', error: 'nope' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.result.reason_code).toBe('task_not_found');
    expect(r.result.evidence).toEqual([{ http_status: 404, body_code: 'task_gone' }]);
  });

  it.each([
    [500, 'upstream down', 'brain_unavailable'],
    [401, '{"error":"no code field"}', 'brain_http_401'],
  ])('响应体无可解析的 code（HTTP %i）-> evidence 只有 http_status', async (status, raw, reason) => {
    reply = { status, raw };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.result.reason_code).toBe(reason);
    expect(r.result.evidence).toEqual([{ http_status: status }]);
  });

  it.each([500, 502, 429, 408])('Brain %i -> retryable brain_unavailable', async (status) => {
    reply = { status, body: { error: 'later' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it('Brain 401 -> fatal brain_http_401', async () => {
    reply = { status: 401, body: { error: 'no' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('brain_http_401');
  });

  it('网络错误（连接被拒）-> retryable brain_unavailable', async () => {
    const r = await runActivityProcess(ENTRY, input({ brain_url: 'http://127.0.0.1:1' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it.each([undefined, '', null, 42])('缺 pr_url（%j）-> fatal pr_url_missing，请求数 0', async (prUrl) => {
    const r = await runActivityProcess(ENTRY, input({ pr_url: prUrl }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('pr_url_missing');
    expect(requests).toHaveLength(0);
  });

  const verification = {
    status: 'failed',
    reason_code: 'verification_failed',
    failed: [{ id: 'E-2', covers: ['I-2'], command: 'npm test', output_tail: 'HTTP 500' }],
  };

  it('有 pr_url 且有 verification -> verification 一并写入 result.coding_workflow', async () => {
    const r = await runActivityProcess(ENTRY, input({ verification }));
    expect(r.exitCode).toBe(0);
    const cw = JSON.parse(requests[0].raw).result.coding_workflow;
    expect(cw.pr_url).toBe('https://github.com/example/repo/pull/2');
    expect(cw.verification).toEqual(verification);
  });

  it('上下文有合同对抗摘要 gan 与升级 escalations → 一并写入 result.coding_workflow（coding commander 据此处理）', async () => {
    const gan = { verdict: 'FORCED', rounds: 3, trend: 'oscillating', open_issues: [{ id: 'R-1', severity: '阻断', targets: ['S-1'] }], cost_usd: 2 };
    const escalations = [{ type: 'gan_forced', trend: 'oscillating', round: 3, open_issues: gan.open_issues }];
    const r = await runActivityProcess(ENTRY, input({ gan, escalations }));
    expect(r.exitCode, r.stderr).toBe(0);
    const cw = JSON.parse(requests[0].raw).result.coding_workflow;
    expect(cw.gan).toEqual(gan);
    expect(cw.escalations).toEqual(escalations);
  });
  it('没有 pr_url 但有 verification -> 仍 PATCH 失败结论，回写成功即 completed', async () => {
    const r = await runActivityProcess(ENTRY, input({ pr_url: undefined, branch: undefined, chain_files: undefined, verification }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs).toEqual({ reported: true });
    expect(requests).toHaveLength(1);
    const body = JSON.parse(requests[0].raw);
    expect(Object.keys(body)).toEqual(['result']);
    expect(body.result.coding_workflow).toEqual({ status: 'failed', run_tag: 'rt-1', sprint_dir: 'sprints/s1', verification });
  });

  it('没有 pr_url、verification 不是对象 -> 维持 fatal pr_url_missing，请求数 0', async () => {
    const r = await runActivityProcess(ENTRY, input({ pr_url: undefined, verification: 'failed' }));
    expect(r.result.reason_code).toBe('pr_url_missing');
    expect(requests).toHaveLength(0);
  });

  it('没有 pr_url 的失败回写遇 Brain 500 -> retryable brain_unavailable', async () => {
    reply = { status: 500, body: {} };
    const r = await runActivityProcess(ENTRY, input({ pr_url: undefined, verification }));
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it('缺 task_id -> fatal task_id_missing，请求数 0', async () => {
    const r = await runActivityProcess(ENTRY, input({ task_id: '' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(requests).toHaveLength(0);
  });

  it('不碰文件系统：不要求 worktree，sprint_dir 原样回写', async () => {
    const r = await runActivityProcess(ENTRY, input({ sprint_dir: 'sprints/weird' }));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(requests[0].raw).result.coding_workflow.sprint_dir).toBe('sprints/weird');
  });
});
