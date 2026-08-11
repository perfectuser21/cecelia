/**
 * GET /api/brain/harness/pr-ownership 归属端点集成测试（真实 PostgreSQL）
 *
 * 合并权收归单一裁决闸（#4755/#4759 修法）。归属只凭 initiative_runs.pr_url 精确匹配
 * （/pull/<n> 结尾），不看标题/分支名。禁 mock 边：端点↔initiative_runs 必须打真 Postgres，
 * 禁止 mock pool 返回假 owned（见 sprint 合同「禁 mock 边清单」）。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务，migrate.js 已建 initiative_runs）。
 *
 * 覆盖：
 *   - 已写入 pr_url 的 harness PR → owned:true + run_id 为 UUID（归属只信 pr_url）
 *   - 未写入 pr_url 的 PR 号 → owned:false + run_id:null（真手动 /dev 不误拦）
 *   - 前缀号不误命中：seed /pull/4755，查 475 与 47550 均 owned:false
 *   - pr_url 尾部 /files、尾部 / 仍命中
 *   - pr_number 非法 → 400 + error 字段
 *   - #4755 / #4759 两起历史事故 → 均 owned:true（回归红线）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 用高位、独一的 PR 号避免与既有行冲突；测试后按 pr_url 精确清理。
const OWNED_PR = 990004755;      // 主命中用例
const OWNED_PR_SUFFIX = 990004756; // 尾部 /files 命中用例
const OWNED_PR_SLASH = 990004757;  // 尾部 / 命中用例
const NOT_OWNED_PR = 990099001;  // 从不 seed
const REG_4755 = 4755;           // 历史事故回归
const REG_4759 = 4759;

const REPO = 'perfectuser21/cecelia';
const seededUrls = [
  `https://github.com/${REPO}/pull/${OWNED_PR}`,
  `https://github.com/${REPO}/pull/${OWNED_PR_SUFFIX}/files`,
  `https://github.com/${REPO}/pull/${OWNED_PR_SLASH}/`,
  `https://github.com/${REPO}/pull/${REG_4755}`,
  `https://github.com/${REPO}/pull/${REG_4759}`,
];

let app;

async function seed(prUrl) {
  await testPool.query(
    `INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(), $1)`,
    [prUrl],
  );
}

beforeAll(async () => {
  // 清理可能残留的同 pr_url 行（幂等）
  await testPool.query(`DELETE FROM initiative_runs WHERE pr_url = ANY($1::text[])`, [seededUrls]);
  for (const url of seededUrls) await seed(url);

  const routerMod = await import('../../routes/harness.js');
  app = express();
  app.use(express.json());
  app.use('/', routerMod.default);
});

afterAll(async () => {
  await testPool.query(`DELETE FROM initiative_runs WHERE pr_url = ANY($1::text[])`, [seededUrls]);
  await testPool.end();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('GET /pr-ownership 归属端点（真实 Postgres）', () => {
  it('已写入 pr_url 的 harness PR → owned:true + run_id 为 UUID', async () => {
    const res = await request(app).get(`/pr-ownership?pr_number=${OWNED_PR}`);
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(true);
    expect(res.body.run_id).toMatch(UUID_RE);
    expect(res.body.pr_number).toBe(OWNED_PR);
    expect(typeof res.body.reason).toBe('string');
  });

  it('未写入 pr_url 的 PR 号 → owned:false + run_id:null（不误拦手动 /dev）', async () => {
    const res = await request(app).get(`/pr-ownership?pr_number=${NOT_OWNED_PR}`);
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
    expect(res.body.run_id).toBe(null);
  });

  it('前缀号不误命中：seed /pull/4755，查 475 → owned:false', async () => {
    const res = await request(app).get('/pr-ownership?pr_number=475');
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
  });

  it('后缀号不误命中：查 47550 → owned:false（不被 4755 子串误伤）', async () => {
    const res = await request(app).get('/pr-ownership?pr_number=47550');
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
  });

  it('pr_url 尾部 /files 仍精确命中', async () => {
    const res = await request(app).get(`/pr-ownership?pr_number=${OWNED_PR_SUFFIX}`);
    expect(res.body.owned).toBe(true);
  });

  it('pr_url 尾部 / 仍精确命中', async () => {
    const res = await request(app).get(`/pr-ownership?pr_number=${OWNED_PR_SLASH}`);
    expect(res.body.owned).toBe(true);
  });

  it('pr_number 非法（abc）→ 400 + error 字段', async () => {
    const res = await request(app).get('/pr-ownership?pr_number=abc');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('pr_number=0 / 负数 → 400（非正整数）', async () => {
    expect((await request(app).get('/pr-ownership?pr_number=0')).status).toBe(400);
    expect((await request(app).get('/pr-ownership?pr_number=-1')).status).toBe(400);
  });

  it('回归红线：#4755 / #4759 两起历史事故均 owned:true（当天绕过 judge 不重演）', async () => {
    const r4755 = await request(app).get(`/pr-ownership?pr_number=${REG_4755}`);
    const r4759 = await request(app).get(`/pr-ownership?pr_number=${REG_4759}`);
    expect(r4755.body.owned).toBe(true);
    expect(r4759.body.owned).toBe(true);
  });
});
