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
import { mkdtempSync, rmSync, appendFileSync, writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
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

function seedTrackedHostSample() {
  mkdirSync(join(clone, '.runtime'));
  const samplePath = join(clone, '.runtime', 'host-disk.json');
  writeFileSync(samplePath, JSON.stringify({
    sampled_at_epoch: 1,
    data_avail_bytes: 50392907776,
    apfs_unallocated_bytes: 50392907776,
    effective_free_bytes: 50392907776,
    usage_pct: 76,
  }));
  sh(`git -C "${clone}" add .runtime/host-disk.json && git -C "${clone}" ${GIT_ID} commit -q -m 'add tracked sample' && git -C "${clone}" push -q origin main`);
  writeFileSync(samplePath, JSON.stringify({
    sampled_at_epoch: Math.floor(Date.now() / 1000),
    data_avail_bytes: 973357056,
    apfs_unallocated_bytes: 973357056,
    effective_free_bytes: 973357056,
    usage_pct: 97,
  }));
  return samplePath;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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

  it('AUTORESET=1：重置 tracked 磁盘样本后原样恢复宿主采样字节', () => {
    const samplePath = seedTrackedHostSample();
    const beforeSha = sha256(samplePath);
    const beforeEpoch = JSON.parse(readFileSync(samplePath, 'utf8')).sampled_at_epoch;
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).toBe(0);
    const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
    expect(sha256(samplePath)).toBe(beforeSha);
    expect(sample.sampled_at_epoch).toBe(beforeEpoch);
    expect(sample.effective_free_bytes).toBe(973357056);
    expect(r.stdout).toContain('宿主磁盘采样已恢复');
    expect(readdirSync(join(clone, '.runtime')).filter(name => name.startsWith('.host-disk-deploy-'))).toEqual([]);
  });

  it('AUTORESET=1：原本无活样本时清除 Git 重置带回的历史样本', () => {
    const samplePath = seedTrackedHostSample();
    rmSync(samplePath);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).toBe(0);
    expect(existsSync(samplePath)).toBe(false);
  });

  it('AUTORESET=1：活样本备份失败时硬红且原样保留', () => {
    const samplePath = seedTrackedHostSample();
    const beforeSha = sha256(samplePath);
    const fakeBin = join(base, 'fake-bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'mktemp'), '#!/usr/bin/env bash\nexit 9\n');
    chmodSync(join(fakeBin, 'mktemp'), 0o755);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', PATH: `${fakeBin}:${process.env.PATH}` });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('宿主磁盘采样备份失败');
    expect(sha256(samplePath)).toBe(beforeSha);
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
