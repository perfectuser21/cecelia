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
import { mkdtempSync, rmSync, appendFileSync, writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, statSync, existsSync } from 'fs';
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

function seedWorkersConfig() {
  const directory = join(clone, 'packages/workflows/staff');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'workers.config.json');
  writeFileSync(path, '{"workers":["source-v1"]}\n');
  sh(`git -C "${clone}" add packages/workflows/staff/workers.config.json && git -C "${clone}" ${GIT_ID} commit -q -m 'workers v1' && git -C "${clone}" push -q origin main`);
  const passed = sh(`git -C "${clone}" rev-parse HEAD`).trim();
  writeFileSync(path, '{"workers":["source-v2"]}\n');
  sh(`git -C "${clone}" add packages/workflows/staff/workers.config.json && git -C "${clone}" ${GIT_ID} commit -q -m 'workers v2' && git -C "${clone}" push -q origin main`);
  writeFileSync(path, '{\r\n  "workers": ["actual-runtime"], "enabled": false\r\n}\r\n');
  chmodSync(path, 0o640);
  return { path, passed, bytes: readFileSync(path), mode: statSync(path).mode & 0o777 };
}

function fakeCommand(name, content) {
  const bin = join(base, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), '#!/usr/bin/env bash\n' + content + '\n', { mode: 0o755 });
  return `${bin}:${process.env.PATH}`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('deploy-root-guard', () => {
  it('main前进后仍把发布根固定到已通过CI的完整SHA', () => {
    const passed = sh(`git -C "${clone}" rev-parse HEAD`).trim();
    appendFileSync(join(clone,'tracked.txt'),'untested next main\n');
    sh(`git -C "${clone}" add tracked.txt && git -C "${clone}" ${GIT_ID} commit -q -m next && git -C "${clone}" push -q origin main`);
    const r=runDeploy({CECELIA_DEPLOY_AUTORESET:'1',EXPECTED_SHA:passed});
    expect(r.status,r.stdout+r.stderr).toBe(0);
    expect(sh(`git -C "${clone}" rev-parse HEAD`).trim()).toBe(passed);
    expect(readFileSync(join(clone,'tracked.txt'),'utf8')).toBe('v1\n');
  });
  it('固定已通过CI的SHA后，实际workers配置原始字节和权限不得被Git替换', () => {
    const worker = seedWorkersConfig();
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', EXPECTED_SHA: worker.passed });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(sh(`git -C "${clone}" rev-parse HEAD`).trim()).toBe(worker.passed);
    expect(readFileSync(worker.path)).toEqual(worker.bytes);
    expect(statSync(worker.path).mode & 0o777).toBe(worker.mode);
    expect(r.stdout).toContain('运行时worker配置已恢复');
    expect(readdirSync(join(clone, '.runtime')).filter(name => name.startsWith('.workers-config-deploy-'))).toEqual([]);
  });

  it.each(['checkout', 'reset'])('%s失败仍恢复磁盘样本和workers原始配置，拒绝部署', command => {
    const worker = seedWorkersConfig();
    const sample = seedTrackedHostSample();
    const sampleHash = sha256(sample);
    const path = fakeCommand('git', `if [[ "$3" == ${command} ]]; then exit 9; fi\nexec /usr/bin/git "$@"`);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', EXPECTED_SHA: worker.passed, PATH: path });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain(`${command}`);
    expect(readFileSync(worker.path)).toEqual(worker.bytes);
    expect(statSync(worker.path).mode & 0o777).toBe(worker.mode);
    expect(sha256(sample)).toBe(sampleHash);
    expect(r.stdout).toContain('宿主磁盘采样已恢复');
    expect(r.stdout).toContain('运行时worker配置已恢复');
  });

  it('workers备份失败时在Git变更前拒绝，原始输入不丢失', () => {
    const worker = seedWorkersConfig();
    const head = sh(`git -C "${clone}" rev-parse HEAD`).trim();
    const path = fakeCommand('cp', 'if [[ "$1" == */workers.config.json ]]; then exit 9; fi\nexec /bin/cp "$@"');
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', EXPECTED_SHA: worker.passed, PATH: path });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('运行时worker配置备份失败');
    expect(sh(`git -C "${clone}" rev-parse HEAD`).trim()).toBe(head);
    expect(readFileSync(worker.path)).toEqual(worker.bytes);
    expect(statSync(worker.path).mode & 0o777).toBe(worker.mode);
  });

  it.each(['host-disk.json', 'workers.config.json'])('%s恢复失败也执行另一项恢复，并保留失败输入600权限备份', file => {
    const worker = seedWorkersConfig();
    const sample = seedTrackedHostSample();
    const sampleHash = sha256(sample);
    const path = fakeCommand('mv', `if [[ "\${@: -1}" == */${file} ]]; then exit 9; fi\nexec /bin/mv "$@"`);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', EXPECTED_SHA: worker.passed, PATH: path });
    expect(r.status).not.toBe(0);
    const prefix = file === 'host-disk.json' ? '.host-disk-deploy-' : '.workers-config-deploy-';
    const backups = readdirSync(join(clone, '.runtime')).filter(name => name.startsWith(prefix));
    expect(backups).toHaveLength(1);
    const backup = join(clone, '.runtime', backups[0]);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(sha256(backup)).toBe(file === 'host-disk.json' ? sampleHash : createHash('sha256').update(worker.bytes).digest('hex'));
    if (file === 'host-disk.json') {
      expect(readFileSync(worker.path)).toEqual(worker.bytes);
      expect(statSync(worker.path).mode & 0o777).toBe(worker.mode);
      expect(existsSync(sample)).toBe(false);
    } else {
      expect(sha256(sample)).toBe(sampleHash);
    }
  });

  it('非main历史的SHA不得在生产部署根执行', () => {
    sh(`git -C "${clone}" checkout -q -b cp-unmerged`);
    appendFileSync(join(clone,'tracked.txt'),'not merged\n');
    sh(`git -C "${clone}" add tracked.txt && git -C "${clone}" ${GIT_ID} commit -q -m unmerged`);
    const sha=sh(`git -C "${clone}" rev-parse HEAD`).trim();
    const r=runDeploy({CECELIA_DEPLOY_AUTORESET:'1',EXPECTED_SHA:sha});
    expect(r.status).not.toBe(0);
    expect(r.stdout+r.stderr).toContain('发布SHA');
  });

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
    expect(statSync(samplePath).mode & 0o777).toBe(0o600);
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

  it('AUTORESET=1：恢复失败时硬红、清除 Git 旧样本并保留 600 权限备份', () => {
    const samplePath = seedTrackedHostSample();
    const beforeSha = sha256(samplePath);
    const fakeBin = join(base, 'fake-bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'mv'), '#!/usr/bin/env bash\nexit 9\n');
    chmodSync(join(fakeBin, 'mv'), 0o755);
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1', PATH: `${fakeBin}:${process.env.PATH}` });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('宿主磁盘采样恢复失败');
    expect(existsSync(samplePath)).toBe(false);
    const backups = readdirSync(join(clone, '.runtime')).filter(name => name.startsWith('.host-disk-deploy-'));
    expect(backups).toHaveLength(1);
    const backupPath = join(clone, '.runtime', backups[0]);
    expect(sha256(backupPath)).toBe(beforeSha);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
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
