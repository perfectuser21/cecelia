/**
 * GET /skill-drift — snapshotDir 必须尊重 process.env.REPO_ROOT（生产容器路径修复）。
 *
 * 根因（生产 #3338 实证）：snapshotDir 默认 join(REPO_ROOT, 'packages','workflows','skills')，
 * 而模块级 REPO_ROOT 由 import.meta.url 计算 → Brain 镜像里是 /app，/app 下无 packages/workflows
 * → snapshot_version 全 null → any_drift 恒 true。但 deploy（docker-compose.yml）已把宿主 repo
 * 以绝对路径挂进容器、且已设 env REPO_ROOT=/Users/administrator/perfect21/cecelia（zombie-cleaner
 * /emergency-cleanup/startup-recovery 都用 process.env.REPO_ROOT || fallback 的惯例）。
 * 修复：snapshotDir 默认改用 process.env.REPO_ROOT || 模块计算值，复用现成 env + 挂载。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

const SKILLS = [
  'harness-planner',
  'harness-contract-proposer',
  'harness-contract-reviewer',
  'harness-generator',
  'harness-evaluator',
  'harness-report',
];
const TEST_VERSION = '9.9.9-test';

describe('GET /skill-drift snapshotDir 尊重 process.env.REPO_ROOT', () => {
  let app;
  let snapshotRoot;
  let ssotRoot;
  const saved = {};

  beforeEach(async () => {
    vi.clearAllMocks();
    snapshotRoot = mkdtempSync(path.join(tmpdir(), 'skill-drift-snap-'));
    ssotRoot = mkdtempSync(path.join(tmpdir(), 'skill-drift-ssot-'));
    for (const name of SKILLS) {
      const snapDir = path.join(snapshotRoot, 'packages', 'workflows', 'skills', name);
      const ssotDir = path.join(ssotRoot, name);
      mkdirSync(snapDir, { recursive: true });
      mkdirSync(ssotDir, { recursive: true });
      writeFileSync(path.join(snapDir, 'SKILL.md'), `---\nversion: ${TEST_VERSION}\n---\n`, 'utf8');
      writeFileSync(path.join(ssotDir, 'SKILL.md'), `---\nversion: ${TEST_VERSION}\n---\n`, 'utf8');
    }
    // 关键：只设 REPO_ROOT，不设 SKILLS_SNAPSHOT_DIR —— 走 REPO_ROOT fallback 分支
    saved.REPO_ROOT = process.env.REPO_ROOT;
    saved.SKILLS_SNAPSHOT_DIR = process.env.SKILLS_SNAPSHOT_DIR;
    saved.SKILLS_SSOT_DIR = process.env.SKILLS_SSOT_DIR;
    process.env.REPO_ROOT = snapshotRoot;
    delete process.env.SKILLS_SNAPSHOT_DIR;
    process.env.SKILLS_SSOT_DIR = ssotRoot;

    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { rmSync(snapshotRoot, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(ssotRoot, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('snapshot 从 process.env.REPO_ROOT 路径读到（snapshot_version 非 null）且与 SSOT 一致 → any_drift=false', async () => {
    const res = await request(app).get('/skill-drift');
    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(SKILLS.length);
    for (const s of res.body.skills) {
      expect(s.snapshot_version).toBe(TEST_VERSION);
      expect(s.ssot_version).toBe(TEST_VERSION);
      expect(s.drifted).toBe(false);
    }
    expect(res.body.any_drift).toBe(false);
  });
});
