/**
 * deploy-sha-gate.test.js
 * SHA 对账判变回归测试（Gate3 假跳过根治 v2，bug becfd554）。
 * G1 版本号兜底在 squash merge 不 bump version 时失效（#4024 webhook 假跳过实证）。
 * 本测试用 mkdtempSync 创建 bare origin + clone 驱动真实 deploy-local.sh。
 *
 * 测试钩子：
 *   CECELIA_PROD_GIT_SHA  → 注入假生产 SHA（跳过真实 curl）
 *   GIT_SHA               → 模拟 webhook 子进程继承的生产容器 SHA
 *   CECELIA_DEPLOY_ROOT   → 隔离不碰真实仓库
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
const GIT_ID = '-c user.email=t@t.t -c user.name=t';

let base, origin, clone;

function sh(cmd) { return execSync(cmd, { encoding: 'utf8' }); }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'deploy-sha-'));
  origin = join(base, 'origin.git');
  clone = join(base, 'clone');
  sh(`git init --bare -q "${origin}"`);
  sh(`git clone -q "${origin}" "${clone}"`);
  sh(`git -C "${clone}" checkout -q -b main`);
  writeFileSync(join(clone, 'README.md'), 'init\n');
  sh(`git -C "${clone}" add README.md && git -C "${clone}" ${GIT_ID} commit -q -m init`);
  sh(`git -C "${clone}" push -q -u origin main`);
});

afterEach(() => { rmSync(base, { recursive: true, force: true }); });

/**
 * 运行 deploy-local.sh（无 FORCE_GUARD，纯测 SHA 对账逻辑）。
 * @param {object} extraEnv  额外环境变量
 * @param {string[]} extraArgs 额外 CLI 参数
 * @param {string[]} unsetEnv  需要从子进程环境中显式删除的变量
 */
function runDeploy(extraEnv = {}, extraArgs = [], unsetEnv = []) {
  const env = {
    ...process.env,
    CECELIA_DEPLOY_ROOT: clone,
    // 不带 FORCE_GUARD → 跳过部署根守卫（与 smoke 隔离模式一致）
    ...extraEnv,
  };
  for (const name of unsetEnv) delete env[name];

  return spawnSync('bash', [SCRIPT, ...extraArgs, 'main'], {
    cwd: clone,
    env,
    encoding: 'utf8',
  });
}

describe('deploy-sha-gate (Gate3 假跳过根治 v2)', () => {
  it('Case 0 [Red→Green]: 显式生产 SHA 未设 + webhook GIT_SHA 落后 origin/main → 触发 Brain 部署', () => {
    const oldProdSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();

    writeFileSync(join(clone, 'README.md'), 'origin/main advanced\n');
    sh(`git -C "${clone}" add README.md && git -C "${clone}" ${GIT_ID} commit -q -m advance`);
    sh(`git -C "${clone}" push -q origin main`);
    const originSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();
    expect(originSha).not.toBe(oldProdSha);

    const r = runDeploy(
      { GIT_SHA: oldProdSha },
      ['--dry-run'],
      ['CECELIA_PROD_GIT_SHA'],
    );

    const out = r.stdout + r.stderr;
    expect(r.status).toBe(0);
    expect(out).toContain(`origin/main=${originSha} 生产=${oldProdSha} → 不等`);
    expect(out).toContain('[dry-run] bash');
    expect(out).toContain('brain-deploy.sh');
  });

  it('Case 1 [Red→Green]: CHANGED_FILES 为空 + 生产 SHA ≠ origin/main → 输出含 SHA 对账且触发 Brain 部署', () => {
    // origin/main 的 SHA（clone 推过去的那个 init commit）
    const originSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();
    // 注入一个不同的假生产 SHA → 模拟生产跑旧镜像
    const fakeProdSha = 'deadbeef0000000000000000000000000000000000';
    expect(originSha).not.toBe(fakeProdSha);

    // 不传 --changed，CHANGED_FILES 将为空 → 靠 SHA 对账兜底
    const r = runDeploy({ CECELIA_PROD_GIT_SHA: fakeProdSha });

    const out = r.stdout + r.stderr;
    // 必须输出 SHA 对账字样
    expect(out).toMatch(/SHA 对账/);
    // 必须提示 Brain 部署被触发
    expect(out).toMatch(/Brain 部署|brain-deploy|Brain 改动/);
  });

  it('Case 2: SHA 相等 → 输出含"一致"或"跳过"，不触发 Brain 部署', () => {
    // 注入与 origin/main 相同的 SHA
    const originSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();
    const inheritedStaleSha = 'deadbeef0000000000000000000000000000000000';

    const r = runDeploy({
      CECELIA_PROD_GIT_SHA: originSha,
      GIT_SHA: inheritedStaleSha,
    });

    const out = r.stdout + r.stderr;
    expect(r.status).toBe(0);
    // 输出含"一致"或"跳过"
    expect(out).toMatch(/一致|跳过/);
    // 不应触发 brain-deploy（无 brain 相关输出）
    expect(out).not.toMatch(/Brain 改动|brain-deploy/);
  });

  it('Case 3: --changed=packages/brain/src/server.js + SHA 相等 → 仍触发 Brain 改动（文件列表优先）', () => {
    const originSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();

    // SHA 相等但文件列表含 brain 核心文件 → 文件列表本身就应触发 Brain 部署
    const r = runDeploy(
      { CECELIA_PROD_GIT_SHA: originSha },
      ['--changed=packages/brain/src/server.js'],
    );

    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Brain 改动|brain-deploy/);
  });

  it('Case 4: 无 brain 改动 + SHA 相等 → 完全跳过，stdout 含"跳过"', () => {
    const originSha = sh(`git -C "${clone}" rev-parse origin/main`).trim();

    // --changed 传非 brain 文件，SHA 相等
    const r = runDeploy(
      { CECELIA_PROD_GIT_SHA: originSha },
      ['--changed=README.md'],
    );

    const out = r.stdout + r.stderr;
    expect(r.status).toBe(0);
    expect(out).toMatch(/跳过/);
    expect(out).not.toMatch(/Brain 改动|brain-deploy/);
  });
});
