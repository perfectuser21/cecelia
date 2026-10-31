/**
 * deploy-root-guard.test.js
 * 部署根守卫回归测试（07-10 Gate3 五连红根因：部署根被有头会话带离 main + 静默降级）。
 * 用临时 bare origin + clone 驱动真实 deploy-local.sh：
 *  - 非 main 分支 / tracked 脏 → exit≠0 且输出含"部署根守卫"
 *  - CECELIA_DEPLOY_AUTORESET=1 → 自愈（回 main + reset --hard）后继续
 *  - 干净 main → 通过守卫（无相关改动 → exit 0 跳过部署）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, appendFileSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
const SAMPLER = new URL('../../../../scripts/host-disk-sampler.sh', import.meta.url).pathname;
const GIT_ID = '-c user.email=t@t.t -c user.name=t';

let base, clone;

function sh(cmd) { return execSync(cmd, { encoding: 'utf8' }); }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'deploy-guard-'));
  const origin = join(base, 'origin.git');
  clone = join(base, 'clone');
  sh(`git init --bare -q "${origin}"`);
  sh(`git clone -q "${origin}" "${clone}"`);
  sh(`git -C "${clone}" checkout -q -b main`);
  writeFileSync(join(clone, 'tracked.txt'), 'v1\n');
  sh(`git -C "${clone}" add tracked.txt && git -C "${clone}" ${GIT_ID} commit -q -m init`);
  sh(`git -C "${clone}" push -q -u origin main`);
});

afterEach(() => { rmSync(base, { recursive: true, force: true }); });

function runDeploy(extraEnv = {}) {
  return spawnSync('bash', [SCRIPT, '--changed=README.md', 'main'], {
    cwd: clone,
    env: {
      ...process.env,
      CECELIA_DEPLOY_ROOT: clone,
      CECELIA_DEPLOY_FORCE_GUARD: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function seedTrackedHostSample({ failingSampler = false } = {}) {
  mkdirSync(join(clone, '.runtime'));
  mkdirSync(join(clone, 'scripts'));
  const samplePath = join(clone, '.runtime', 'host-disk.json');
  writeFileSync(samplePath, JSON.stringify({
    sampled_at_epoch: 1,
    data_avail_bytes: 50392907776,
    apfs_unallocated_bytes: 50392907776,
    effective_free_bytes: 50392907776,
    usage_pct: 76,
  }));
  const samplerPath = join(clone, 'scripts', 'host-disk-sampler.sh');
  if (failingSampler) writeFileSync(samplerPath, '#!/usr/bin/env bash\nexit 9\n');
  else copyFileSync(SAMPLER, samplerPath);
  sh(`git -C "${clone}" add .runtime/host-disk.json scripts/host-disk-sampler.sh && git -C "${clone}" ${GIT_ID} commit -q -m 'add tracked sample' && git -C "${clone}" push -q origin main`);
  writeFileSync(samplePath, JSON.stringify({
    sampled_at_epoch: Math.floor(Date.now() / 1000),
    data_avail_bytes: 973357056,
    apfs_unallocated_bytes: 973357056,
    effective_free_bytes: 973357056,
    usage_pct: 97,
  }));
  return samplePath;
}

describe('deploy-root-guard', () => {
  it('部署根不在 main 分支 → 硬红 exit≠0', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    const r = runDeploy();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('部署根守卫');
  });

  it('部署根 tracked 文件脏 → 硬红 exit≠0', () => {
    appendFileSync(join(clone, 'tracked.txt'), 'dirty\n');
    const r = runDeploy();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('部署根守卫');
  });

  it('AUTORESET=1：离 main + 脏 → 自愈回 origin/main 后通过（exit 0）', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    appendFileSync(join(clone, 'tracked.txt'), 'dirty\n');
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).toBe(0);
    const branch = sh(`git -C "${clone}" symbolic-ref --short HEAD`).trim();
    expect(branch).toBe('main');
    const dirty = sh(`git -C "${clone}" status --porcelain --untracked-files=no`).trim();
    expect(dirty).toBe('');
  });

  it('AUTORESET=1：重置 tracked 磁盘样本后，部署判定前重新采集真实宿主数据', () => {
    const samplePath = seedTrackedHostSample();
    const startedAt = Math.floor(Date.now() / 1000);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).toBe(0);
    const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
    expect(sample.sampled_at_epoch).toBeGreaterThanOrEqual(startedAt);
    expect(sample.effective_free_bytes).toBeGreaterThan(0);
    expect(r.stdout).toContain('host-disk');
  });

  it('AUTORESET=1：重采样失败则清除 Git 旧样本并阻断部署', () => {
    const samplePath = seedTrackedHostSample({ failingSampler: true });
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).not.toBe(0);
    expect(existsSync(samplePath)).toBe(false);
    expect(r.stdout + r.stderr).toContain('磁盘采样失败');
  });

  it('干净 main → 通过守卫，无相关改动 exit 0', () => {
    const r = runDeploy();
    expect(r.status).toBe(0);
  });

  it('无 FORCE_GUARD（现有 smoke 隔离模式）→ 不跑守卫，行为不变', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    const r = spawnSync('bash', [SCRIPT, '--changed=README.md', 'main'], {
      cwd: clone,
      env: { ...process.env, CECELIA_DEPLOY_ROOT: clone },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
