import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../db.js', () => ({
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

function writeSkill(baseDir, name, version) {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  const fm = version === null
    ? `---\nname: ${name}\ndescription: test\n---\nbody\n`
    : `---\nname: ${name}\ndescription: test\nversion: ${version}\n---\nbody\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm, 'utf8');
}

const ALL_SAME = Object.fromEntries(HARNESS_SKILLS.map((n) => [n, '1.0.0']));

describe('GET /skill-drift', () => {
  let app;
  let ssotDir;
  let snapDir;

  async function buildApp(ssotVersions, snapVersions) {
    ssotDir = mkdtempSync(join(tmpdir(), 'skill-drift-ssot-'));
    snapDir = mkdtempSync(join(tmpdir(), 'skill-drift-snap-'));
    for (const name of HARNESS_SKILLS) {
      if (name in ssotVersions) writeSkill(ssotDir, name, ssotVersions[name]);
      if (name in snapVersions) writeSkill(snapDir, name, snapVersions[name]);
    }
    process.env.SKILLS_SSOT_DIR = ssotDir;
    process.env.SKILLS_SNAPSHOT_DIR = snapDir;
    vi.resetModules();
    const routerMod = await import('../harness.js');
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

  it('返回 200，skills 恰好 6 项，顶层/项级 keys 严格完整', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['any_drift', 'skills']);
    expect(res.body.skills).toHaveLength(6);
    expect(res.body.skills.map((s) => s.name).sort()).toEqual([...HARNESS_SKILLS].sort());
    for (const s of res.body.skills) {
      expect(Object.keys(s).sort()).toEqual(['drifted', 'name', 'snapshot_version', 'ssot_version']);
    }
  });

  it('两侧版本相同 → 每项 drifted=false 且 any_drift=false；版本不同 → 翻转且 drifted == 真实对比', async () => {
    await buildApp(ALL_SAME, { ...ALL_SAME, 'harness-report': '2.0.0' });
    const res = await request(app).get('/skill-drift');
    const report = res.body.skills.find((s) => s.name === 'harness-report');
    expect(report.ssot_version).toBe('1.0.0');
    expect(report.snapshot_version).toBe('2.0.0');
    expect(report.drifted).toBe(true);
    expect(res.body.any_drift).toBe(true);
    expect(res.body.any_drift).toBe(res.body.skills.some((s) => s.drifted));
    for (const s of res.body.skills) {
      expect(s.drifted).toBe(s.ssot_version !== s.snapshot_version);
    }
  });

  it('边界：快照侧文件缺失 → snapshot_version=null 且 drifted=true', async () => {
    const snap = { ...ALL_SAME };
    delete snap['harness-evaluator'];
    await buildApp(ALL_SAME, snap);
    const res = await request(app).get('/skill-drift');
    const item = res.body.skills.find((s) => s.name === 'harness-evaluator');
    expect(item.snapshot_version).toBeNull();
    expect(item.drifted).toBe(true);
    expect(res.body.any_drift).toBe(true);
  });

  it('边界：SSOT 侧 frontmatter 无 version 行 → ssot_version=null 且 drifted=true', async () => {
    await buildApp({ ...ALL_SAME, 'harness-generator': null }, ALL_SAME);
    const res = await request(app).get('/skill-drift');
    const item = res.body.skills.find((s) => s.name === 'harness-generator');
    expect(item.ssot_version).toBeNull();
    expect(item.drifted).toBe(true);
  });

  it('SSOT 支持 skills/<name>/SKILL.md 备选布局探测', async () => {
    ssotDir = mkdtempSync(join(tmpdir(), 'skill-drift-ssot-'));
    snapDir = mkdtempSync(join(tmpdir(), 'skill-drift-snap-'));
    const nested = join(ssotDir, 'skills');
    mkdirSync(nested, { recursive: true });
    for (const name of HARNESS_SKILLS) {
      writeSkill(nested, name, '1.0.0');
      writeSkill(snapDir, name, '1.0.0');
    }
    process.env.SKILLS_SSOT_DIR = ssotDir;
    process.env.SKILLS_SNAPSHOT_DIR = snapDir;
    vi.resetModules();
    const routerMod = await import('../harness.js');
    app = express();
    app.use('/', routerMod.default);
    const res = await request(app).get('/skill-drift');
    expect(res.body.skills.every((s) => s.ssot_version === '1.0.0')).toBe(true);
    expect(res.body.any_drift).toBe(false);
  });

  it('真实读盘：同一 app 内改快照 version 后再请求，drifted 翻转（禁止缓存）', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res1 = await request(app).get('/skill-drift');
    expect(res1.body.any_drift).toBe(false);
    writeSkill(snapDir, 'harness-report', '0.0.0-drift-test');
    const res2 = await request(app).get('/skill-drift');
    const flipped = res2.body.skills.find((s) => s.name === 'harness-report');
    expect(flipped.snapshot_version).toBe('0.0.0-drift-test');
    expect(flipped.drifted).toBe(true);
    expect(res2.body.any_drift).toBe(true);
  });

  it('error path：POST 同路径返回非 200', async () => {
    await buildApp(ALL_SAME, ALL_SAME);
    const res = await request(app).post('/skill-drift');
    expect(res.status).not.toBe(200);
  });
});
