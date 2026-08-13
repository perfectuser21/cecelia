import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';

// F1 Capability 可重复认证闭环 — 最短 smoke（PR CI: harness-v5-checks tests-actually-pass，
// 起真 Postgres + Brain server:5221）。禁 mock 被改的边：全程真 PG + 真 HTTP。
// 冻结身份（task_bundle SSOT，跨角色/GAN 轮次不变，可字面固定）。
const GP_CONTRACT_ID = '48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3';
const GP_CONTRACT_HASH = '3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8';
const JOURNEY_ID = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';
const STEP_ID = 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b';
const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const SEED = 'packages/brain/scripts/integration/seed-f1-cert-fixture.js';

let dbUrl: string;

function resolveDbUrl(): string {
  if (process.env.DB_URL) return process.env.DB_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME || 'cecelia';
  const user = process.env.DB_USER || 'cecelia';
  const pass = process.env.DB_PASSWORD || 'cecelia';
  return `postgresql://${user}:${pass}@${host}:${port}/${name}`;
}

function seed(kase: string): any {
  const out = execFileSync('node', [SEED, kase], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: dbUrl, DB_URL: dbUrl },
  });
  const line = out.trim().split('\n').filter(Boolean).pop() as string;
  return JSON.parse(line);
}

async function certify(hash: string, mergeSha: string | null): Promise<any> {
  const q = new URLSearchParams({
    gp_contract_id: GP_CONTRACT_ID,
    gp_contract_version: '1',
    gp_contract_hash: hash,
    journey_id: JOURNEY_ID,
    step_id: STEP_ID,
  });
  if (mergeSha) q.set('expected_merge_sha', mergeSha);
  const res = await fetch(`${BRAIN}/api/brain/capabilities/F1/certification?${q.toString()}`);
  expect(res.ok, `certification endpoint should exist and return 2xx (got ${res.status})`).toBe(true);
  return res.json();
}

beforeAll(() => {
  dbUrl = resolveDbUrl();
});

describe('F1 Capability certification 闭环 smoke [BEHAVIOR]', () => {
  it('certification 端点对冻结身份返回 green（非 synthetic PASS receipt 支撑）', async () => {
    const fx = seed('green');
    const body = await certify(GP_CONTRACT_HASH, fx.source_sha);
    expect(body.capability).toBe('F1');
    expect(body.state).toBe('green');
    expect(body.synthetic).toBe(false);
    expect(typeof body.receipt_id).toBe('string');
    expect(body.gp_contract_hash).toBe(GP_CONTRACT_HASH);
    expect(body.reason_code).toBe('pass_current_revision');
  });

  it('无 receipt 时不 green（fail-closed gray/no_receipt）', async () => {
    const fx = seed('no_receipt');
    const body = await certify(GP_CONTRACT_HASH, fx.source_sha);
    expect(body.state).not.toBe('green');
    expect(body.reason_code).toBe('no_receipt');
  });
});
