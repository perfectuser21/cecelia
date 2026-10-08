// new-task.mjs：按计划 JSON 建一条或一批带开关的 coding 任务（Commander 与 /dev 小改动入口）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePlan } from '../new-task.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '../new-task.mjs');
const PROJECT_ID = 'p0000000-0000-4000-8000-000000000001';
const ROOT_ID = '11111111-1111-4111-8111-111111111111';

function startBrain({ failAt = null, projectFail = false } = {}) {
  const state = { posts: [], projectPosts: [], order: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/brain/projects') {
        const body = JSON.parse(raw);
        state.projectPosts.push(body);
        state.order.push('project');
        if (projectFail) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'db_down' })); }
        res.statusCode = 201;
        return res.end(JSON.stringify({ id: PROJECT_ID, ...body }));
      }
      if (req.method !== 'POST' || req.url !== '/api/brain/tasks') { res.statusCode = 404; return res.end('{}'); }
      const body = JSON.parse(raw);
      state.posts.push(body);
      state.order.push('task');
      if (failAt === state.posts.length) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'change_kind_required' })); }
      res.statusCode = 201;
      return res.end(JSON.stringify({ id: `00000000-0000-4000-8000-00000000000${state.posts.length}`, ...body }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    state.url = `http://127.0.0.1:${server.address().port}`;
    state.close = () => new Promise((r) => server.close(r));
    resolve(state);
  }));
}

function runScript(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('new-task.mjs', () => {
  let dir;
  let brain;
  const plan = (obj) => {
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(obj));
    return file;
  };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-newtask-')); });
  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('单条：建成带开关的 data 任务（coding_workflow / headed_manual / repo / acceptance），输出 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ title: '改 X', description: '为什么', acceptance: ['命令 A 输出 B'] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.posts).toHaveLength(1);
    expect(brain.posts[0]).toMatchObject({
      task_type: 'data',
      title: '改 X',
      description: '为什么',
      trigger_source: 'manual',
      payload: { coding_workflow: true, headed_manual: 'true', repo: 'cecelia', acceptance: ['命令 A 输出 B'], gp_anchor: 'none(infra)' },
    });
    expect(brain.posts[0].payload.depends_on).toBeUndefined();
    expect(brain.posts[0].project_id).toBeUndefined();
    expect(JSON.parse(r.stdout)).toEqual([{ key: null, id: '00000000-0000-4000-8000-000000000001', title: '改 X' }]);
  });

  it('批次：按顺序创建，depends_on 的 key 换成前面任务的真实 id，带 batch 名', async () => {
    brain = await startBrain();
    const r = await runScript([plan({
      batch: 'big-1',
      project_id: ROOT_ID,
      tasks: [
        { key: 'a', title: '第一步', acceptance: ['a ok'] },
        { key: 'b', title: '第二步', acceptance: ['b ok'], depends_on: ['a'] },
        { key: 'c', title: '第三步', acceptance: ['c ok'], depends_on: ['a', 'b'], priority: 'P1' },
      ],
    })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.posts.map((p) => p.title)).toEqual(['第一步', '第二步', '第三步']);
    expect(brain.posts[1].payload.depends_on).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(brain.posts[2].payload.depends_on).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(brain.posts[2].priority).toBe('P1');
    expect(brain.posts.every((p) => p.payload.batch === 'big-1')).toBe(true);
  });

  it('计划带 project：先建 project（只一次），整批任务顶层都挂它的 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({
      project: { name: '大改X', description: '为什么' },
      tasks: [
        { key: 'a', title: '一', acceptance: ['x'] },
        { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
      ],
    })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toHaveLength(1);
    expect(brain.projectPosts[0]).toMatchObject({ name: '大改X', description: '为什么' });
    expect(brain.posts).toHaveLength(2);
    expect(brain.posts.every((p) => p.project_id === PROJECT_ID)).toBe(true);
    expect(brain.order).toEqual(['project', 'task', 'task']);
    expect(JSON.parse(r.stdout).map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('建 project 失败：退出非 0，stderr 说明，不建任何任务', async () => {
    brain = await startBrain({ projectFail: true });
    const r = await runScript([plan({ project: { name: '大改X' }, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('建 project 失败');
    expect(brain.posts).toEqual([]);
  });

  it('计划带 project_id：不建 project，每条任务顶层挂该 id，depends_on 仍换真实 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ project_id: ROOT_ID, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toEqual([]);
    expect(brain.posts).toHaveLength(2);
    expect(brain.posts.every((p) => p.project_id === ROOT_ID)).toBe(true);
    expect(brain.posts[1].payload.depends_on).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('单条计划带 project_id：请求体顶层同样带上', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ project_id: ROOT_ID, title: '改 X', acceptance: ['x'] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toEqual([]);
    expect(brain.posts).toHaveLength(1);
    expect(brain.posts[0].project_id).toBe(ROOT_ID);
  });

  it('--dry-run 带 project：不调 Brain', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ project: { name: 'n' }, title: 't', acceptance: ['x'] }), '--dry-run'], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toEqual([]);
    expect(brain.posts).toEqual([]);
  });

  it('--dry-run：只校验并打印，不调 Brain', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ title: 't', acceptance: ['x'] }), '--dry-run'], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.posts).toEqual([]);
  });

  it('中途 Brain 拒绝：退出非 0，stderr 列出已建的任务，后面不再建', async () => {
    brain = await startBrain({ failAt: 2 });
    const r = await runScript([plan({ project_id: ROOT_ID, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
      { key: 'c', title: '三', acceptance: ['x'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code).not.toBe(0);
    expect(brain.posts).toHaveLength(2);
    expect(r.stderr).toContain('00000000-0000-4000-8000-000000000001');
    expect(r.stderr).toContain('change_kind_required');
  });

  it.each([
    ['缺标题', { acceptance: ['x'] }, 'title_missing'],
    ['验收为空', { title: 't', acceptance: [] }, 'acceptance_missing'],
    ['验收含空串', { title: 't', acceptance: ['ok', ' '] }, 'acceptance_missing'],
    ['依赖指向后面的任务', { tasks: [{ key: 'a', title: 't', acceptance: ['x'], depends_on: ['b'] }, { key: 'b', title: 't', acceptance: ['x'] }] }, 'depends_on_unknown:b'],
    ['重复 key', { tasks: [{ key: 'a', title: 't', acceptance: ['x'] }, { key: 'a', title: 't', acceptance: ['x'] }] }, 'key_duplicate:a'],
    ['有依赖但自己没 key 的前置', { tasks: [{ title: 't', acceptance: ['x'] }, { key: 'b', title: 't', acceptance: ['x'], depends_on: ['a'] }] }, 'depends_on_unknown:a'],
    ['有依赖但没挂 project', { tasks: [{ key: 'a', title: 't', acceptance: ['x'] }, { key: 'b', title: 't', acceptance: ['x'], depends_on: ['a'] }] }, 'project_required'],
    ['project 缺 name', { project: { description: 'd' }, tasks: [{ key: 'a', title: 't', acceptance: ['x'] }] }, 'project_name_missing'],
    ['project_id 与 project 同时给', { project_id: ROOT_ID, project: { name: 'n' }, title: 't', acceptance: ['x'] }, 'project_conflict'],
  ])('校验：%s → %s，不调 Brain', async (_name, obj, code) => {
    expect(validatePlan(obj).errors.join(' ')).toContain(code);
    brain = await startBrain();
    const r = await runScript([plan(obj)], { BRAIN_URL: brain.url });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(code);
    expect(brain.posts).toEqual([]);
    expect(brain.projectPosts).toEqual([]);
  });

  it('校验：返回 projectId / project', () => {
    expect(validatePlan({ project_id: ROOT_ID, title: 't', acceptance: ['x'] })).toMatchObject({ projectId: ROOT_ID, project: null, errors: [] });
    expect(validatePlan({ project: { name: 'n' }, title: 't', acceptance: ['x'] })).toMatchObject({ projectId: null, project: { name: 'n', description: '' }, errors: [] });
    expect(validatePlan({ title: 't', acceptance: ['x'] })).toMatchObject({ projectId: null, project: null, errors: [] });
  });
});
