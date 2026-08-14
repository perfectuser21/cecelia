/**
 * eval-upload.integration.test.js — POST /api/skill-eval/upload 真实 PostgreSQL 集成测试
 *
 * 与 eval.test.js 的区别：
 *   - eval.test.js mock 掉 db.js，只测路由层中间件/鉴权/响应格式
 *   - 本文件不 mock db.js，接真实 PostgreSQL，验证真实 INSERT 语句能否跑通
 *     （mock 测试测不出"列名不存在/CHECK 约束不满足"这类 SQL 层 bug）
 *
 * 运行环境：CI brain-integration job（`npx vitest run src/__tests__/integration/`，含真实
 * PostgreSQL 服务 + 已跑过 migrate.js）——必须放在 src/__tests__/integration/ 目录下，
 * brain-unit job 用 --exclude='src/__tests__/integration/**' 排除本目录（它没有 Postgres 服务）。
 * 依赖：系统 `zip` 命令构造测试 fixture（ubuntu-latest 镜像自带，若切换 runner 镜像需确认）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DB_DEFAULTS } from '../../db-config.js';
import evalRouter from '../../routes/eval.js';
import { cleanupRoutedTasks } from '../helpers/routed-task-cleanup.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录本次测试插入的 task_id，afterAll 清理（先删 skill_evals 子表，再删 tasks 父表）
const insertedTaskIds = [];
// 记录 buildRealZipBuffer 创建的临时目录，afterAll 一并清理，避免测试环境积累垃圾文件
const createdTmpDirs = [];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/skill-eval', evalRouter);
  return app;
}

function buildRealZipBuffer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-upload-it-'));
  createdTmpDirs.push(tmpDir);
  const skillDir = path.join(tmpDir, 'it-smoke-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: it-smoke-skill\ndescription: 集成测试用最小 skill\n---\n\n# IT Smoke Skill\n'
  );
  const zipPath = path.join(tmpDir, 'it-smoke-skill.zip');
  execSync(`cd ${tmpDir} && zip -r ${zipPath} it-smoke-skill > /dev/null`);
  return fs.readFileSync(zipPath);
}

describe('POST /api/skill-eval/upload — 真实 PostgreSQL 集成测试', () => {
  let app;

  beforeAll(() => {
    app = makeApp();
  });

  afterAll(async () => {
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM skill_evals WHERE task_id = ANY($1)', [insertedTaskIds]);
      await cleanupRoutedTasks(testPool, insertedTaskIds);
    }
    await testPool.end();
    for (const dir of createdTmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('真实上传合法 skill zip，成功建 tasks + skill_evals 行，返回 200 和 task_id', async () => {
    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', buildRealZipBuffer(), { filename: 'it-smoke-skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'it-smoke-skill')
      .field('submitter', 'integration-test');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task_id');
    insertedTaskIds.push(res.body.task_id);

    const taskRow = await testPool.query(
      `SELECT task_type, status, title FROM tasks WHERE id = $1`,
      [res.body.task_id]
    );
    expect(taskRow.rows).toHaveLength(1);
    expect(taskRow.rows[0].task_type).toBe('skill_eval');
    expect(taskRow.rows[0].status).toBe('pending');

    const evalRow = await testPool.query(
      `SELECT status, skill_name FROM skill_evals WHERE task_id = $1`,
      [res.body.task_id]
    );
    expect(evalRow.rows).toHaveLength(1);
    expect(evalRow.rows[0].status).toBe('pending');
    expect(evalRow.rows[0].skill_name).toBe('it-smoke-skill');
  });
});
