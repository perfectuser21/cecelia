import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAcceptance, renderIntent, intentIdsError, INTENT_ID_RE } from '../lib/intent.mjs';
import { parseFrontmatter, extractAnchors } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '../activities/intent.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('extractAcceptance', () => {
  it('payload.acceptance 优先于 description', () => {
    const items = extractAcceptance({
      description: '验收：①X ②Y ③Z',
      payload: { acceptance: ['A', 'B'] },
    });
    expect(items).toEqual(['A', 'B']);
  });

  it.each([
    ['圈号', '背景说明\n验收：①A ②B'],
    ['编号列表', '背景说明\n验收\n1. A\n2. B'],
    ['复选框列表', '背景说明\n验收\n- [ ] A\n- [ ] B'],
    ['分号', '验收：A；B'],
    ['标题行带"标准"', '## 验收标准\n- A\n- B'],
    ['"验收标准："圈号', '验收标准：①A ②B'],
    ['"验收条件"复选框与星号', '验收条件\n- [x] A\n* B'],
  ])('描述验收段写法：%s', (_name, description) => {
    expect(extractAcceptance({ description })).toEqual(['A', 'B']);
  });

  it('有列表标记时分号不切断条目内部', () => {
    expect(extractAcceptance({ description: '验收\n1. 输出 a; b\n2. C' })).toEqual(['输出 a; b', 'C']);
    expect(extractAcceptance({ description: '验收：①输出 a；b ②C' })).toEqual(['输出 a；b', 'C']);
    expect(extractAcceptance({ description: '验收\n- 输出 a; b\n- C' })).toEqual(['输出 a; b', 'C']);
  });

  it('"验收"后不跟冒号/换行的无关出现被跳过，取下一处', () => {
    expect(extractAcceptance({ description: '验收通过后上线。\n验收：A；B' })).toEqual(['A', 'B']);
  });

  it('行首"2026.10 前完成"这类数字+点+数字不是列表标记：保留为首段文本，后续 "- A" 仍切分', () => {
    expect(extractAcceptance({ description: '验收\n2026.10 前完成\n- A' })).toEqual(['2026.10 前完成', 'A']);
    expect(extractAcceptance({ description: '验收\n1. 提升 1.5 倍\n2. B' })).toEqual(['提升 1.5 倍', 'B']);
  });

  it('没有验收字样或空条目返回空数组', () => {
    expect(extractAcceptance({ description: '只有背景' })).toEqual([]);
    expect(extractAcceptance({ description: '验收：' })).toEqual([]);
    expect(extractAcceptance({})).toEqual([]);
    expect(extractAcceptance({ payload: { acceptance: ['', '  '] } })).toEqual([]);
  });
});

describe('renderIntent', () => {
  it('frontmatter 与锚点符合 md 链格式', () => {
    const md = renderIntent({ taskId: TASK_ID, title: '标题', items: ['A', 'B'] });
    const fm = parseFrontmatter(md);
    expect(fm.data).toEqual({ task_id: TASK_ID, step: 'intent', upstream: [] });
    expect(md).toContain('# 标题');
    expect(md).toContain('### I-1\nA');
    expect(md).toContain('### I-2\nB');
  });

  it('description 非空：在标题与 ### I-1 之间写入 ## 背景 与原文，frontmatter 不变', () => {
    const description = '  背景第一行\n\n背景第二行\n验收：①A ②B  ';
    const md = renderIntent({ taskId: TASK_ID, title: '标题', items: ['A', 'B'], description });
    expect(md).toContain('## 背景\n\n背景第一行\n\n背景第二行\n验收：①A ②B\n\n### I-1');
    expect(md.indexOf('# 标题')).toBeLessThan(md.indexOf('## 背景'));
    expect(md.indexOf('## 背景')).toBeLessThan(md.indexOf('### I-1'));
    expect(parseFrontmatter(md).data).toEqual({ task_id: TASK_ID, step: 'intent', upstream: [] });
  });

  it.each([
    ['空串', ''],
    ['纯空白', '   '],
    ['undefined', undefined],
    ['null', null],
    ['非字符串', 42],
  ])('description 为%s：不出现 ## 背景，且与不传 description 逐字节一致', (_name, description) => {
    const base = renderIntent({ taskId: TASK_ID, title: '标题', items: ['A', 'B'] });
    const md = renderIntent({ taskId: TASK_ID, title: '标题', items: ['A', 'B'], description });
    expect(md).not.toContain('## 背景');
    expect(md).toBe(base);
  });

  it('description 里的 ### I-9 行被转义成 \\### I-9，其余原样保留', () => {
    const description = '前文\n### I-9\n#### I-7 小标题\n后文 ### I-6';
    const md = renderIntent({ taskId: TASK_ID, title: '标题', items: ['A'], description });
    expect(md).toContain('## 背景\n\n前文\n\\### I-9\n#### I-7 小标题\n后文 ### I-6\n\n### I-1\nA');
    expect(extractAnchors(parseFrontmatter(md).body)).toEqual(['I-1']);
  });
});

describe('intent 活动（子进程 + 假 Brain）', () => {
  let server;
  let brainUrl;
  let hits;
  let reply;
  let worktree;

  beforeEach(async () => {
    hits = 0;
    reply = { status: 200, body: {} };
    server = http.createServer((req, res) => {
      hits += 1;
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply.body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    brainUrl = `http://127.0.0.1:${server.address().port}`;
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-test-'));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    brain_url: brainUrl,
    ...patch,
  });
  const intentFile = () => path.join(worktree, 'sprints/s1/01-intent.md');

  it('payload.acceptance 优先：只写 payload 的条目', async () => {
    reply.body = {
      id: TASK_ID,
      title: '任务标题',
      description: '验收：①X ②Y ③Z',
      payload: { acceptance: ['条目一', '条目二'] },
    };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(0);
    expect(r.result.failure_class).toBeNull();
    expect(r.result.run_tag).toBe('rt-1');
    const md = fs.readFileSync(intentFile(), 'utf8');
    // intent_sha256：后续活动据此发现 01 被改
    expect(r.result.outputs).toEqual({
      intent_file: '01-intent.md',
      intent_ids: ['I-1', 'I-2'],
      intent_sha256: crypto.createHash('sha256').update(md).digest('hex'),
    });
    expect(md).toContain('### I-1\n条目一');
    expect(md).toContain('### I-2\n条目二');
    expect(md).not.toContain('### I-3');
    // description 原文进背景小节，X/Y/Z 不成为 I-n 条目
    expect(md).toContain('## 背景\n\n验收：①X ②Y ③Z\n\n### I-1');
    expect(extractAnchors(parseFrontmatter(md).body)).toEqual(['I-1', 'I-2']);
    expect(parseFrontmatter(md).data.task_id).toBe(TASK_ID);
  });

  it('description 写入 ## 背景（无 payload）：位于 ### I-1 之前，intent_ids 只按验收条目', async () => {
    reply.body = { id: TASK_ID, title: '任务标题', description: '背景说明 XYZ\n验收：①A ②B' };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(0);
    const md = fs.readFileSync(intentFile(), 'utf8');
    expect(md).toContain('## 背景');
    expect(md).toContain('背景说明 XYZ');
    expect(md.indexOf('## 背景')).toBeLessThan(md.indexOf('### I-1'));
    expect(md.indexOf('背景说明 XYZ')).toBeLessThan(md.indexOf('### I-1'));
    expect(md).toContain('### I-1\nA');
    expect(md).toContain('### I-2\nB');
    expect(r.result.outputs).toEqual({
      intent_file: '01-intent.md',
      intent_ids: ['I-1', 'I-2'],
      intent_sha256: crypto.createHash('sha256').update(md).digest('hex'),
    });
  });

  it('无验收条目 -> needs_human acceptance_missing，且不写文件', async () => {
    reply.body = { id: TASK_ID, title: 't', description: '只有背景' };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.status).toBe('failed');
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('acceptance_missing');
    expect(fs.existsSync(intentFile())).toBe(false);
  });

  it('Brain 404 -> fatal task_not_found', async () => {
    reply = { status: 404, body: { error: 'Task not found' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_not_found');
  });

  it('Brain 400 -> fatal task_not_found', async () => {
    reply = { status: 400, body: { error: 'bad id' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_not_found');
  });

  it('Brain 500 -> retryable brain_unavailable', async () => {
    reply = { status: 500, body: { error: 'boom' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it.each([429, 408])('Brain %i -> retryable brain_unavailable', async (status) => {
    reply = { status, body: { error: 'later' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it('Brain 401 -> fatal brain_http_401', async () => {
    reply = { status: 401, body: { error: 'no' } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('brain_http_401');
  });

  it('缺 task_id -> fatal task_id_missing，不发请求', async () => {
    const r = await runActivityProcess(ENTRY, input({ task_id: '' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(hits).toBe(0);
  });

  it('网络错误（连接被拒）-> retryable brain_unavailable', async () => {
    const r = await runActivityProcess(ENTRY, input({ brain_url: 'http://127.0.0.1:1' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('brain_unavailable');
  });

  it('sprint_dir 非法 -> fatal sprint_dir_invalid，无网络请求、无文件写出', async () => {
    reply.body = { id: TASK_ID, title: 't', payload: { acceptance: ['A'] } };
    const r = await runActivityProcess(ENTRY, input({ sprint_dir: '../x' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
    expect(hits).toBe(0);
    expect(fs.existsSync(path.join(worktree, '../x'))).toBe(false);
    expect(fs.readdirSync(worktree)).toEqual([]);
  });

  it('重复运行：文件字节一致', async () => {
    reply.body = { id: TASK_ID, title: '标题', payload: { acceptance: ['A', 'B'] } };
    await runActivityProcess(ENTRY, input());
    const first = fs.readFileSync(intentFile());
    await runActivityProcess(ENTRY, input());
    const second = fs.readFileSync(intentFile());
    expect(second.equals(first)).toBe(true);
  });

  it('stdout 只有一个 JSON 对象', async () => {
    reply.body = { id: TASK_ID, title: '标题', payload: { acceptance: ['A'] } };
    const r = await runActivityProcess(ENTRY, input());
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });
});

describe('I-n 格式统一常量', () => {
  it('INTENT_ID_RE 只认 I-<数字>', () => {
    expect(['I-1', 'I-12'].every((id) => INTENT_ID_RE.test(id))).toBe(true);
    expect(['S-1', 'E-1', 'i-1', 'I-', 'I-1x'].some((id) => INTENT_ID_RE.test(id))).toBe(false);
  });
  it('intentIdsError 用同一常量：S-1 等非 I-n 判 intent_ids_invalid', () => {
    expect(intentIdsError(['I-1', 'S-1'])).toBe('intent_ids_invalid');
    expect(intentIdsError(['I-1'])).toBeNull();
  });
});
