// new-task.mjs：按计划 JSON 建一条或一批带开关的 coding 任务（Commander 与 /dev 小改动入口）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { validatePlan as validateRawPlan } from '../new-task.mjs';
import { initCommittableRepo, git } from './helpers/git.mjs';
const routing = { change_kind: 'bugfix', map_scope_hint: ['F1'] };
const validatePlan = (plan, opts) => validateRawPlan({ ...routing, ...plan }, opts);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '../new-task.mjs');
const PROJECT_ID = 'p0000000-0000-4000-8000-000000000001';
const ROOT_ID = '11111111-1111-4111-8111-111111111111';

function managedFixture(root) {
  const clone = path.join(root, 'trusted');
  fs.mkdirSync(clone);
  initCommittableRepo(clone, path.join(root, 'hooks'));
  const kinds = ['spec', 'rule', 'sample', 'implementation'];
  const index = { object_id: 'coding-workflow', refs: kinds.map((kind) => ({ ref_id: kind, kind, path: 'rule.md', required: true })) };
  fs.mkdirSync(path.join(clone, 'docs/registry'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'docs/registry/coding-workflow-authority.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(clone, 'rule.md'), 'trusted rule');
  git(clone, 'add', '.'); git(clone, 'commit', '-qm', 'trusted sources');
  const revision = git(clone, 'rev-parse', 'HEAD').trim();
  git(clone, 'update-ref', 'refs/remotes/origin/main', revision);
  const digest = crypto.createHash('sha256').update('trusted rule').digest('hex');
  return { clone, authority: { object_id: 'coding-workflow', refs: kinds.map((kind) => ({ ref_id: kind, kind, path: 'rule.md', revision, digest, required: true })) } };
}

function startBrain({ failAt = null, projectFail = false, wrongRoute = false, malformedScope = false, wrongBaseSha = false, missingBaseSha = false, dropAuthority = false, deduplicated = false } = {}) {
  const state = { posts: [], projectPosts: [], order: [], gets: [], claims: [], patches: [], rows: new Map() };
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
      if (req.method === 'GET' && req.url.startsWith('/api/brain/tasks/')) { state.gets.push(req.url); return res.end(JSON.stringify(state.rows.get(req.url.split('/').at(-1)))); }
      if (req.method === 'POST' && req.url.endsWith('/claim')) { state.claims.push(req.url); return res.end(JSON.stringify({ ok: true })); }
      if (req.method === 'PATCH' && req.url.startsWith('/api/brain/tasks/')) { const patch = JSON.parse(raw); state.patches.push(patch); const id = req.url.split('/').at(-1); const row = { ...state.rows.get(id), ...patch }; state.rows.set(id, row); return res.end(JSON.stringify(row)); }
      if (req.method !== 'POST' || req.url !== '/api/brain/tasks') { res.statusCode = 404; return res.end('{}'); }
      const body = JSON.parse(raw);
      state.posts.push(body);
      state.order.push('task');
      if (failAt === state.posts.length) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'change_kind_required' })); }
      res.statusCode = deduplicated ? 200 : 201;
      const row = { id: `00000000-0000-4000-8000-00000000000${state.posts.length}`, ...body, payload: { ...body.payload, authority: dropAuthority ? undefined : body.payload.authority, change_kind: body.change_kind, base_sha: missingBaseSha ? undefined : wrongBaseSha ? 'f'.repeat(40) : body.base_sha, map_scope: malformedScope ? {} : body.map_scope_hint, work_kind: wrongRoute ? 'coding_review' : 'coding_mutation', repo: wrongRoute ? null : body.payload.repo, orchestrator: 'coding-workflow-runner' } };
      if (deduplicated) row.deduplicated = true;
      state.rows.set(row.id, row);
      return res.end(JSON.stringify(row));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    state.url = `http://127.0.0.1:${server.address().port}`;
    state.close = () => new Promise((r) => { server.closeAllConnections(); server.close(r); });
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
    fs.writeFileSync(file, JSON.stringify({ ...routing, ...obj }));
    return file;
  };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-newtask-')); });
  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('计划按批次继承 object_id 与 authority_refs，拒绝混用声明', () => {
    const refs = ['spec', 'rule', 'sample', 'implementation'].map((kind) => ({
      ref_id: kind, kind, path: `${kind}.md`, revision: 'a'.repeat(40), digest: 'b'.repeat(64), required: true,
    }));
    const checked = validatePlan({ object_id: 'coding-workflow', authority_refs: refs,
      tasks: [{ title: '一', acceptance: ['A'] }, { title: '二', acceptance: ['B'] }] });
    expect(checked.errors).toEqual([]);
    expect(checked.tasks.map((t) => t.authority)).toEqual([{
      object_id: 'coding-workflow', refs,
    }, { object_id: 'coding-workflow', refs }]);
    const conflict = validatePlan({ object_id: 'coding-workflow', authority_refs: refs,
      authority: { object_id: 'coding-workflow', refs: [] }, title: '坏', acceptance: ['A'] });
    expect(conflict.errors).toContain('#1:authority_declaration_conflict');
  });

  it('真实 CLI 在建单前按可信清单拒绝 package.json 路径替换', async () => {
    const { clone, authority } = managedFixture(dir);
    fs.writeFileSync(path.join(clone, 'package.json'), '{}');
    git(clone, 'add', 'package.json'); git(clone, 'commit', '-qm', 'trusted package');
    const revision = git(clone, 'rev-parse', 'HEAD').trim();
    git(clone, 'update-ref', 'refs/remotes/origin/main', revision);
    const digest = crypto.createHash('sha256').update('{}').digest('hex');
    const replaced = { ...authority, refs: authority.refs.map((ref) => ({ ...ref, path: 'package.json', revision, digest })) };
    const r = await runScript([plan({ title: '路径替换', acceptance: ['A'], object_id: replaced.object_id,
      authority_refs: replaced.refs }), '--dry-run'], { CODING_WF_TRUSTED_REPO: clone });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('authority_path_mismatch');
    expect(r.stdout).toBe('');
  });

  it('受管声明丢失时 GET 核对并安全收账', async () => {
    brain = await startBrain({ dropAuthority: true });
    const { clone, authority } = managedFixture(dir);
    const r = await runScript([plan({ title: '受管', acceptance: ['x'], authority })], { BRAIN_URL: brain.url, CODING_WF_TRUSTED_REPO: clone });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('authority_receipt_mismatch');
    expect(r.stderr).toContain('00000000-0000-4000-8000-000000000001');
    expect(brain.posts[0].payload).toMatchObject({ authority_required: true, authority });
    expect(brain.gets).toHaveLength(2);
    expect(brain.claims).toHaveLength(1);
    expect(brain.patches.at(-1).status).toBe('failed');
  });

  it('复用任务 ID 时只报冲突，不 claim 或写 failed', async () => {
    brain = await startBrain({ deduplicated: true });
    const { clone, authority } = managedFixture(dir);
    const r = await runScript([plan({ title: '复用', acceptance: ['x'], authority })], { BRAIN_URL: brain.url, CODING_WF_TRUSTED_REPO: clone });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('authority_dedup_conflict');
    expect(r.stderr).toContain('00000000-0000-4000-8000-000000000001');
    expect(brain.claims).toEqual([]);
    expect(brain.patches).toEqual([]);
  });

  it('重复 ref_id 整批拒绝，不发 POST', async () => {
    brain = await startBrain();
    const ref = { ref_id: 'rule', kind: 'rule', path: 'rule.md', revision: 'a'.repeat(40), digest: 'b'.repeat(64), required: true };
    const r = await runScript([plan({ title: '坏声明', acceptance: ['x'], authority: { object_id: 'coding-workflow', refs: [ref, ref] } })], { BRAIN_URL: brain.url });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('authority_ref_duplicate');
    expect(brain.posts).toEqual([]);
  });

  it('单条：建成独立类型 coding_workflow 任务（coding_workflow / repo / acceptance，不再借 data + headed_manual），输出 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ title: '改 X', description: '为什么', acceptance: ['命令 A 输出 B'] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.posts).toHaveLength(1);
    expect(brain.posts[0]).toMatchObject({
      task_type: 'coding_workflow', mutation_intent: 'write', change_kind: 'bugfix',
      repo_hint: 'cecelia', map_scope_hint: ['F1'],
      title: '改 X',
      description: '为什么',
      trigger_source: 'manual',
      payload: { coding_workflow: true, repo: 'cecelia', acceptance: ['命令 A 输出 B'], gp_anchor: 'none(infra)' },
    });
    expect(brain.posts[0].payload.headed_manual).toBeUndefined();
    expect(brain.posts[0].payload.depends_on).toBeUndefined();
    expect(brain.posts[0].project_id).toBeUndefined();
    expect(brain.posts[0]).not.toHaveProperty('base_sha');
    expect(JSON.parse(r.stdout)).toEqual([{ key: null, id: '00000000-0000-4000-8000-000000000001', title: '改 X' }]);
  });

  it('显式 base_sha 顶层发送，批次继承且逐条覆盖', async () => {
    brain = await startBrain();
    const first = 'a'.repeat(40), second = 'b'.repeat(40);
    const r = await runScript([plan({ project_id: ROOT_ID, base_sha: first, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], base_sha: second, depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.posts.map((p) => p.base_sha)).toEqual([first, second]);
    expect(brain.posts.every((p) => !Object.hasOwn(p.payload, 'base_sha'))).toBe(true);
  });

  it.each(['abc', 'g'.repeat(40), 'A'.repeat(40), '', null, 42, ['a'.repeat(40)]])('base_sha 非40位小写hex时整批建单前拒绝 %j', async (base_sha) => {
    brain = await startBrain();
    const r = await runScript([plan({ project: { name: '不得创建' }, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], base_sha },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('invalid_base_sha');
    expect(brain.posts).toEqual([]);
    expect(brain.projectPosts).toEqual([]);
  });

  it.each([{ wrongBaseSha: true }, { missingBaseSha: true }])('显式 base_sha 回执不一致 %j：保留已建ID并停后续', async (options) => {
    brain = await startBrain(options);
    const r = await runScript([plan({ base_sha: 'a'.repeat(40), project_id: ROOT_ID, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code).toBe(1);
    expect(brain.posts).toHaveLength(1);
    expect(r.stderr).toContain('task_route_mismatch');
    expect(r.stderr).toContain('00000000-0000-4000-8000-000000000001');
    expect(r.stdout).toBe('');
  });

  it.each([
    [{ change_kind: null }, 'change_kind_required'],
    [{ change_kind: 'wrong' }, 'invalid_change_kind'],
    [{ map_scope_hint: [] }, 'map_scope_required'],
    [{ map_scope_hint: [''] }, 'invalid_map_scope'],
  ])('编码语义不完整时建单前拒绝 %j', async (invalid, error) => {
    brain = await startBrain();
    const r = await runScript([plan({ title: '修路由', acceptance: ['x'], ...invalid })], { BRAIN_URL: brain.url });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(error);
    expect(brain.posts).toEqual([]);
  });

  it.each([{ wrongRoute: true }, { malformedScope: true }])('服务端路由不匹配 %j：保留已建 id，停止依赖批次', async (options) => {
    brain = await startBrain(options);
    const r = await runScript([plan({ project_id: ROOT_ID, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code).toBe(1);
    expect(brain.posts).toHaveLength(1);
    expect(r.stderr).toContain('task_route_mismatch');
    expect(r.stderr).toContain('00000000-0000-4000-8000-000000000001');
    expect(r.stdout).toBe('');
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

  // C6：任务可指定仓库（--repo / 计划顶层 repo / 单条 t.repo），经 repos.json 别名归一写规范 key；未登记的拒绝（不猜）
  describe('--repo：按仓库建任务', () => {
    it('--repo zenithjoy → payload.repo 写规范 key zenithjoy-workspace；C7 已开闸，不再提示未启用', async () => {
      brain = await startBrain();
      const r = await runScript(['--repo', 'zenithjoy', plan({ title: '修 wf-run trap 顺序', acceptance: ['x'] })], { BRAIN_URL: brain.url });
      expect(r.code, r.stderr).toBe(0);
      expect(brain.posts[0].payload).toMatchObject({ coding_workflow: true, repo: 'zenithjoy-workspace' });
      expect(r.stderr).not.toContain('未启用');
    });

    it('仓库登记了但未启用（CODING_WF_REPOS_FILE 指向关闸的表）：照建，stderr 提示 runner 不会认领', async () => {
      brain = await startBrain();
      const real = JSON.parse(fs.readFileSync(path.join(path.dirname(SCRIPT), 'repos.json'), 'utf8'));
      const closed = { repos: real.repos.map((r) => (r.default ? r : { ...r, enabled: false })) };
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repos-closed-')), 'repos.json');
      fs.writeFileSync(file, JSON.stringify(closed));
      const r = await runScript(['--repo', 'zenithjoy', plan({ title: 't', acceptance: ['x'] })], { BRAIN_URL: brain.url, CODING_WF_REPOS_FILE: file });
      expect(r.code, r.stderr).toBe(0);
      expect(brain.posts[0].payload.repo).toBe('zenithjoy-workspace');
      expect(r.stderr).toContain('未启用');
    });

    it('--repo=<URL> 写法同样归一；计划顶层 repo 与单条 t.repo（单条优先）', async () => {
      brain = await startBrain();
      let r = await runScript([`--repo=https://github.com/perfectuser21/zenithjoy-workspace.git`, plan({ title: 't', acceptance: ['x'] })], { BRAIN_URL: brain.url });
      expect(r.code, r.stderr).toBe(0);
      expect(brain.posts[0].payload.repo).toBe('zenithjoy-workspace');
      r = await runScript([plan({ repo: 'zenithjoy', tasks: [{ title: 'a', acceptance: ['x'] }, { title: 'b', acceptance: ['x'], repo: 'cecelia' }] })], { BRAIN_URL: brain.url });
      expect(r.code, r.stderr).toBe(0);
      expect(brain.posts.slice(1).map((p) => p.payload.repo)).toEqual(['zenithjoy-workspace', 'cecelia']);
    });

    it('不给仓库 = cecelia（行为不变）；--dry-run 输出带 repo', async () => {
      const r = await runScript([plan({ title: 't', acceptance: ['x'] }), '--dry-run', '--repo', 'zenithjoy-workspace']);
      expect(r.code, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual([expect.objectContaining({ title: 't', repo: 'zenithjoy-workspace' })]);
      expect(validatePlan({ title: 't', acceptance: ['x'] }).tasks[0].repoKey).toBe('cecelia');
    });

    it('未登记的仓库 → 校验失败 repo_unknown，不调 Brain', async () => {
      expect(validatePlan({ title: 't', acceptance: ['x'], repo: 'nope' }).errors).toContain('#1:repo_unknown:nope');
      expect(validatePlan({ title: 't', acceptance: ['x'] }, { repo: 'nope' }).errors).toContain('#1:repo_unknown:nope');
      brain = await startBrain();
      const r = await runScript(['--repo', 'nope', plan({ title: 't', acceptance: ['x'] })], { BRAIN_URL: brain.url });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('repo_unknown:nope');
      expect(brain.posts).toEqual([]);
    });

    it('--repo 缺值 → 用法错误', async () => {
      const r = await runScript([plan({ title: 't', acceptance: ['x'] }), '--repo']);
      expect(r.code).toBe(2);
    });
  });
});
