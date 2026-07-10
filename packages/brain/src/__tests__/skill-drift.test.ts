import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

const HARNESS_SKILLS = [
  'harness-planner',
  'harness-contract-proposer',
  'harness-contract-reviewer',
  'harness-generator',
  'harness-evaluator',
  'harness-report',
];

const SORTED_NAMES = [...HARNESS_SKILLS].sort();

function writeSkill(baseDir: string, name: string, version: string | null) {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  const fm = version === null
    ? `---\nname: ${name}\ndescription: test\n---\nbody\n`
    : `---\nname: ${name}\ndescription: test\nversion: ${version}\n---\nbody\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm, 'utf8');
}

function makeDirs(ssotVersions: Record<string, string | null>, snapVersions: Record<string, string | null>) {
  const ssotDir = mkdtempSync(join(tmpdir(), 'skill-drift-ssot-'));
  const snapDir = mkdtempSync(join(tmpdir(), 'skill-drift-snap-'));
  for (const name of HARNESS_SKILLS) {
    if (name in ssotVersions) writeSkill(ssotDir, name, ssotVersions[name]);
    if (name in snapVersions) writeSkill(snapDir, name, snapVersions[name]);
  }
  return { ssotDir, snapDir };
}

const ALL_SAME = Object.fromEntries(HARNESS_SKILLS.map((n) => [n, '1.0.0']));

describe('GET /api/brain/harness/skill-drift [BEHAVIOR]', () => {
  let app: express.Express;
  let ssotDir: string;
  let snapDir: string;

  async function buildApp(ssotVersions: Record<string, string | null>, snapVersions: Record<string, string | null>) {
    const dirs = makeDirs(ssotVersions, snapVersions);
    ssotDir = dirs.ssotDir;
    snapDir = dirs.snapDir;
    process.env.SKILLS_SSOT_DIR = ssotDir;
    process.env.SKILLS_SNAPSHOT_DIR = snapDir;
    vi.resetModules();
    const routerMod = await import('../routes/harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  }

  afterEach(() => {
    if (ssotDir) rmSync(ssotDir, { recursive: true, force: true });
    if (snapDir) rmSync(snapDir, { recursive: true, force: true });
    delete process.env.SKILLS_SSOT_DIR;
    delete process.env.SKILLS_SNAPSHOT_DIR;
  });

  it('返回 HTTP 200，skills 恰好 6 项，name 集合精确等于 6 个 harness skill', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(6);
    expect(res.body.skills.map((s: any) => s.name).sort()).toEqual(SORTED_NAMES);
  });

  it('每项 4 字段齐全且类型正确（name string / drifted boolean / version 为 string 或 null）', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    expect(res.status).toBe(200);
    for (const s of res.body.skills) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.drifted).toBe('boolean');
      expect(s.ssot_version === null || typeof s.ssot_version === 'string').toBe(true);
      expect(s.snapshot_version === null || typeof s.snapshot_version === 'string').toBe(true);
    }
  });

  it('keys 完整性：顶层严格 ["any_drift","skills"]，项级严格 4 keys', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    expect(Object.keys(res.body).sort()).toEqual(['any_drift', 'skills']);
    for (const s of res.body.skills) {
      expect(Object.keys(s).sort()).toEqual(['drifted', 'name', 'snapshot_version', 'ssot_version']);
    }
  });

  it('禁用字段不出现（anyDrift/hasDrift/drift/items/list/skillList/versions/ssotVersion/snapshotVersion/is_drifted）', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    for (const k of ['anyDrift', 'hasDrift', 'has_drift', 'drift', 'items', 'list', 'skillList', 'versions']) {
      expect(res.body).not.toHaveProperty(k);
    }
    for (const s of res.body.skills) {
      for (const k of ['ssotVersion', 'snapshotVersion', 'version_ssot', 'version_snapshot', 'is_drifted', 'isDrifted']) {
        expect(s).not.toHaveProperty(k);
      }
    }
  });

  it('两侧版本全部相同 → 每项 drifted=false 且 any_drift=false', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    expect(res.body.skills.every((s: any) => s.drifted === false)).toBe(true);
    expect(res.body.any_drift).toBe(false);
  });

  it('一项版本不同 → 该项 drifted=true，any_drift=true，且 any_drift == 数组 any(drifted)（内部一致性）', async () => {
    const snap = { ...ALL_SAME, 'harness-report': '2.0.0' };
    await buildApp(ALL_SAME, snap);
    const res = await request(app).get('/skill-drift');
    const report = res.body.skills.find((s: any) => s.name === 'harness-report');
    expect(report.ssot_version).toBe('1.0.0');
    expect(report.snapshot_version).toBe('2.0.0');
    expect(report.drifted).toBe(true);
    expect(res.body.any_drift).toBe(true);
    expect(res.body.any_drift).toBe(res.body.skills.some((s: any) => s.drifted));
    for (const s of res.body.skills) {
      expect(s.drifted).toBe(s.ssot_version !== s.snapshot_version);
    }
  });

  it('边界：快照侧 SKILL.md 文件不存在 → snapshot_version=null 且 drifted=true', async () => {
    const snap: Record<string, string | null> = { ...ALL_SAME };
    delete snap['harness-evaluator'];
    await buildApp(ALL_SAME, snap);
    const res = await request(app).get('/skill-drift');
    const item = res.body.skills.find((s: any) => s.name === 'harness-evaluator');
    expect(item.snapshot_version).toBeNull();
    expect(item.drifted).toBe(true);
    expect(res.body.any_drift).toBe(true);
  });

  it('边界：SSOT 侧 frontmatter 无 version: 行 → ssot_version=null 且 drifted=true', async () => {
    const ssot: Record<string, string | null> = { ...ALL_SAME, 'harness-generator': null };
    await buildApp(ssot, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    const item = res.body.skills.find((s: any) => s.name === 'harness-generator');
    expect(item.ssot_version).toBeNull();
    expect(item.drifted).toBe(true);
  });

  it('真实读盘翻转：请求后改快照 version 为 0.0.0-drift-test 再请求，drifted 必须翻转（禁止缓存/硬编码）', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res1 = await request(app).get('/skill-drift');
    expect(res1.body.skills.find((s: any) => s.name === 'harness-report').drifted).toBe(false);

    writeSkill(snapDir, 'harness-report', '0.0.0-drift-test');
    const res2 = await request(app).get('/skill-drift');
    const flipped = res2.body.skills.find((s: any) => s.name === 'harness-report');
    expect(flipped.snapshot_version).toBe('0.0.0-drift-test');
    expect(flipped.drifted).toBe(true);
    expect(res2.body.any_drift).toBe(true);

    writeSkill(snapDir, 'harness-report', '1.0.0');
    const res3 = await request(app).get('/skill-drift');
    expect(res3.body.skills.find((s: any) => s.name === 'harness-report').snapshot_version).toBe('1.0.0');
    expect(res3.body.any_drift).toBe(false);
  });

  it('error path：POST 同路径返回非 200（方法语义）', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).post('/skill-drift');
    expect(res.status).not.toBe(200);
  });

  it('防 404 假绿：未注册路由的空 app GET 返回非 200', async () => {
    const emptyApp = express();
    const res = await request(emptyApp).get('/skill-drift');
    expect(res.status).not.toBe(200);
  });
});
