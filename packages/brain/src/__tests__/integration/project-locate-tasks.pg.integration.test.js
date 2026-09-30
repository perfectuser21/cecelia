/**
 * /api/brain/projects/locate + /api/brain/projects/:id/tasks —— 真 PostgreSQL 验证。
 * 链 2afa6d69 棒3，任务 8a40825a。
 *
 * mock 测不到两件事：
 *   1. /locate 的 LATERAL JOIN（open_task_count/last_activity_at）在真 PG 上语法/语义正确，
 *      关键词回退打分（本测试强制无 OPENAI_API_KEY）真能把语义相关的 project 排到前面。
 *   2. /:id/tasks 走真 createRoutedTask：sequence_no 真是该 project 下 max+1、project_id 真回填、
 *      depends_on 默认真指向"该 project 下最后一个非终态任务"、建单闸（project-root-gate）真放行。
 *
 * 建库→跑全量 migrate.js→用完即删，照 project-root-gate.pg.integration.test.js 的手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({
  default: {
    query: (...a) => holder.pool.query(...a),
    connect: (...a) => holder.pool.connect(...a),
  },
}));

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let pool;
let databaseName;
let router;
let app;
let savedOpenAiKey;

function quoteIdentifier(value) {
  if (!/^projlocate_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

async function mkProject({ name, description = null, status = 'active', krId = null, brief = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO projects (name, description, status, kr_id, brief)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [name, description, status, krId, brief ? JSON.stringify(brief) : '{}'],
  );
  return rows[0].id;
}

async function mkTask({ projectId, title, sequenceNo, status = 'queued' }) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, project_id, sequence_no)
     VALUES ($1, 'dev', $2, 'P2', $3, $4) RETURNING id`,
    [title, status, projectId, sequenceNo],
  );
  return rows[0].id;
}

beforeAll(async () => {
  databaseName = `projlocate_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  holder.pool = pool;
  router = (await import('../../routes/project-locate-routes.js')).default;
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

beforeEach(() => {
  // 关键词回退打分必须是确定性的：本文件不测 embedding 路径（那是 project-locate.test.js 的事），
  // 强制拔掉 key，保证 scoreProjectCandidates 稳定走 keyword 分支。
  savedOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use('/projects', router);
  app = expressApp;
});

afterEach(() => {
  if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
});

describe.sequential('POST /projects/locate（真库，关键词回退）', () => {
  it('语义相关的 project 排在前面（关键词打分），reason=keyword_bigram_jaccard', async () => {
    await mkProject({ name: '智能获客链路优化', description: '抖音快手小红书获客第三期' });
    await mkProject({ name: '微信客服RPA排障', description: '个微客服消息路由' });

    const res = await request(app).post('/projects/locate').send({ text: '给智能获客链路加一步优化' });
    expect(res.status).toBe(200);
    expect(res.body.candidates.length).toBeGreaterThan(0);
    expect(res.body.candidates[0].name).toBe('智能获客链路优化');
    expect(res.body.candidates[0].reason).toBe('keyword_bigram_jaccard');
  });

  it('文本与候选名称完全一致（bigram Jaccard=1）→ suggestion=attach', async () => {
    // 关键词 Jaccard 打分对长描述会被稀释（description 越长、并集越大、分母越大），
    // 这里只测名称精确命中，确认分数能越过默认阈值 0.55——long-description 稀释场景
    // 是上一条用例覆盖的"排序正确"，不在这条断言 suggestion。
    await mkProject({ name: '智能获客链路优化' });

    const res = await request(app).post('/projects/locate').send({ text: '智能获客链路优化' });
    expect(res.status).toBe(200);
    expect(res.body.candidates[0].name).toBe('智能获客链路优化');
    expect(res.body.candidates[0].score).toBe(1);
    expect(res.body.suggestion).toBe('attach');
  });

  it('完全不相关的描述 → suggestion=create', async () => {
    await mkProject({ name: '智能获客链路优化', description: '抖音快手小红书获客第三期' });

    const res = await request(app).post('/projects/locate').send({ text: '完全无关的东西随便写写' });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBe('create');
  });

  it('open_task_count/last_activity_at 来自真 LATERAL JOIN 聚合', async () => {
    const pid = await mkProject({ name: '归位聚合测试项目' });
    await mkTask({ projectId: pid, title: '归位聚合-t1', sequenceNo: 1, status: 'queued' });
    await mkTask({ projectId: pid, title: '归位聚合-t2', sequenceNo: 2, status: 'completed' });

    const res = await request(app).post('/projects/locate').send({ text: '归位聚合测试项目' });
    const hit = res.body.candidates.find((c) => c.project_id === pid);
    expect(hit).toBeTruthy();
    expect(hit.open_task_count).toBe(1); // 只算未终态的
  });

  it('kr_id 过滤：只返回该 kr 下的候选', async () => {
    const { rows: krRows } = await pool.query(
      `INSERT INTO key_results (title) VALUES ('归位测试 KR') RETURNING id`,
    );
    const krId = krRows[0].id;
    const pidWithKr = await mkProject({ name: '挂KR的归位项目', krId });
    await mkProject({ name: '不挂KR的归位项目' });

    const res = await request(app).post('/projects/locate').send({ text: '归位项目', kr_id: krId });
    expect(res.status).toBe(200);
    for (const c of res.body.candidates) {
      expect(c.project_id).toBe(pidWithKr);
    }
  });

  it('已完成/已取消的 project 不进候选集', async () => {
    await mkProject({ name: '已归档的归位项目', status: 'completed' });
    const res = await request(app).post('/projects/locate').send({ text: '已归档的归位项目' });
    expect(res.body.candidates.find((c) => c.name === '已归档的归位项目')).toBeUndefined();
  });
});

describe.sequential('POST /projects/:id/tasks（真库：建单闸 + sequence_no + depends_on）', () => {
  it('project 下建第一棒：sequence_no=1，project_id 回填，无前置任务时 depends_on=[]', async () => {
    const pid = await mkProject({ name: '接力棒真库测试-A' });
    const res = await request(app).post(`/projects/${pid}/tasks`).send({
      title: '第1棒', task_type: 'research',
    });
    expect(res.status).toBe(201);
    expect(res.body.project_id).toBe(pid);
    expect(res.body.sequence_no).toBe(1);
    expect(res.body.payload.depends_on).toEqual([]);
  });

  it('未声明 depends_on 时默认依赖该 project 下最后一个非终态任务；sequence_no 递增', async () => {
    const pid = await mkProject({ name: '接力棒真库测试-B' });
    const first = await mkTask({ projectId: pid, title: '既有第1棒', sequenceNo: 1, status: 'in_progress' });

    const res = await request(app).post(`/projects/${pid}/tasks`).send({
      title: '第2棒', task_type: 'research',
    });
    expect(res.status).toBe(201);
    expect(res.body.sequence_no).toBe(2);
    expect(res.body.payload.depends_on).toEqual([first]);

    const edge = await pool.query(
      'SELECT edge_type FROM task_dependencies WHERE from_task_id = $1 AND to_task_id = $2',
      [res.body.id, first],
    );
    expect(edge.rows).toEqual([{ edge_type: 'hard' }]);
  });

  it('已完成的前置任务不会被自动选为 depends_on（只挑非终态）', async () => {
    const pid = await mkProject({ name: '接力棒真库测试-C' });
    await mkTask({ projectId: pid, title: '已完成第1棒', sequenceNo: 1, status: 'completed' });

    const res = await request(app).post(`/projects/${pid}/tasks`).send({
      title: '第2棒（不该依赖已完成的）', task_type: 'research',
    });
    expect(res.status).toBe(201);
    expect(res.body.payload.depends_on).toEqual([]);
  });

  it('显式 depends_on: [] 声明并行，即使存在非终态前置任务也不自动挂依赖', async () => {
    const pid = await mkProject({ name: '接力棒真库测试-D' });
    await mkTask({ projectId: pid, title: '既有任务', sequenceNo: 1, status: 'queued' });

    const res = await request(app).post(`/projects/${pid}/tasks`).send({
      title: '并行棒', task_type: 'research', depends_on: [],
    });
    expect(res.status).toBe(201);
    expect(res.body.payload.depends_on).toEqual([]);
  });

  it('project 不存在 → 404', async () => {
    const res = await request(app).post(`/projects/${randomUUID()}/tasks`).send({
      title: 't', task_type: 'research',
    });
    expect(res.status).toBe(404);
  });
});
