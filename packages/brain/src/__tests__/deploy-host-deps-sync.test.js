/**
 * deploy-host-deps-sync.test.js
 * 部署宿主机依赖同步回归测试。
 *
 * 真实事故（2026-07-19）：pre-swap smoke 里 harness-schema-validation-smoke.sh 与其余
 * 4 条不同——不是纯 HTTP 探测 green 容器，而是直接在宿主机本地 Node 进程 import brain
 * 源码模块做白盒验证。deploy-local.sh 的"部署根守卫"块只 git pull 同步宿主机 checkout
 * (MAIN_ROOT/DEPLOY_ROOT_DIR) 的代码，从未同步执行 npm install/ci 更新其 node_modules。
 * 一旦最新代码新增/变更了依赖（如 zod），宿主机 checkout 的 node_modules 落后于代码，
 * smoke 脚本因 "Cannot find package" 误判部署失败——即使 Docker 镜像本身完全正常。
 * 本次连续 3 次(PR#4108/4116/4118)生产部署因此原地失败，生产版本卡在旧版本不动。
 *
 * 修法：NEED_BRAIN==true 分支里，调用 brain-deploy.sh 之前先为 $MAIN_ROOT 跑
 * `npm ci --workspace=packages/brain`，同步失败则拒绝部署（不能带着滞后依赖继续）。
 *
 * 用 stub npm（PATH 注入假可执行脚本记录调用参数）+ 假 brain-deploy.sh（记录被调用）
 * 验证调用时序，不真的跑网络安装/docker 操作。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
const GIT_ID = '-c user.email=t@t.t -c user.name=t';

let base, origin, clone, stubBinDir, npmCallsFile, brainDeployCallsFile;

function sh(cmd) { return execSync(cmd, { encoding: 'utf8' }); }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'deploy-hostdeps-'));
  origin = join(base, 'origin.git');
  clone = join(base, 'clone');
  sh(`git init --bare -q "${origin}"`);
  sh(`git clone -q "${origin}" "${clone}"`);
  sh(`git -C "${clone}" checkout -q -b main`);

  // 最小化 packages/brain/package.json，让 npm ci 有个 workspace 目标
  mkdirSync(join(clone, 'packages', 'brain'), { recursive: true });
  writeFileSync(join(clone, 'packages', 'brain', 'package.json'), JSON.stringify({
    name: 'cecelia-brain', version: '0.0.0', dependencies: {},
  }));
  writeFileSync(join(clone, 'package.json'), JSON.stringify({
    name: 'cecelia-root', workspaces: ['packages/brain'],
  }));

  // 假 scripts/brain-deploy.sh：只记录被调用，不真的做 docker 操作
  mkdirSync(join(clone, 'scripts'), { recursive: true });
  brainDeployCallsFile = join(base, 'brain-deploy-calls.log');
  writeFileSync(join(clone, 'scripts', 'brain-deploy.sh'),
    `#!/usr/bin/env bash\necho "brain-deploy-called $(date +%s%N)" >> "${brainDeployCallsFile}"\n`);
  chmodSync(join(clone, 'scripts', 'brain-deploy.sh'), 0o755);

  sh(`git -C "${clone}" add -A && git -C "${clone}" ${GIT_ID} commit -q -m init`);
  sh(`git -C "${clone}" push -q -u origin main`);

  // stub npm：记录调用参数和调用时间，模拟成功（exit 0）
  stubBinDir = join(base, 'stub-bin');
  mkdirSync(stubBinDir, { recursive: true });
  npmCallsFile = join(base, 'npm-calls.log');
  writeFileSync(join(stubBinDir, 'npm'),
    `#!/usr/bin/env bash\necho "$* $(date +%s%N)" >> "${npmCallsFile}"\nexit 0\n`);
  chmodSync(join(stubBinDir, 'npm'), 0o755);
});

afterEach(() => { rmSync(base, { recursive: true, force: true }); });

function runDeploy(extraEnv = {}, extraArgs = []) {
  return spawnSync('bash', [SCRIPT, ...extraArgs, 'main'], {
    cwd: clone,
    env: {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      CECELIA_DEPLOY_ROOT: clone,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

describe('deploy-host-deps-sync', () => {
  it('NEED_BRAIN=true → 调用 brain-deploy.sh 之前先跑 npm ci --workspace=packages/brain', () => {
    const r = runDeploy({}, ['--changed=packages/brain/src/server.js']);

    expect(existsSync(npmCallsFile)).toBe(true);
    const npmCalls = readFileSync(npmCallsFile, 'utf8').trim().split('\n');
    const ciCall = npmCalls.find((l) => l.includes('ci') && l.includes('--workspace=packages/brain'));
    expect(ciCall).toBeTruthy();

    expect(existsSync(brainDeployCallsFile)).toBe(true);
    const brainDeployTime = Number(readFileSync(brainDeployCallsFile, 'utf8').trim().split(' ')[1]);
    const npmCiTime = Number(ciCall.trim().split(' ').pop());
    expect(npmCiTime).toBeLessThan(brainDeployTime);

    expect(r.status).toBe(0);
  });

  it('npm ci 同步失败 → 拒绝部署，不调用 brain-deploy.sh（不能带着滞后依赖继续）', () => {
    // stub npm 改为失败退出
    writeFileSync(join(stubBinDir, 'npm'),
      `#!/usr/bin/env bash\necho "$* $(date +%s%N)" >> "${npmCallsFile}"\nexit 1\n`);
    chmodSync(join(stubBinDir, 'npm'), 0o755);

    const r = runDeploy({}, ['--changed=packages/brain/src/server.js']);

    expect(r.status).not.toBe(0);
    expect(existsSync(brainDeployCallsFile)).toBe(false);
  });

  it('--dry-run → 不真的调用 npm，只打印意图', () => {
    const r = runDeploy({}, ['--dry-run', '--changed=packages/brain/src/server.js']);

    expect(existsSync(npmCallsFile)).toBe(false);
    expect(r.status).toBe(0);
  });

  it('NEED_BRAIN=false（无 brain 改动）→ 不调用 npm ci', () => {
    const r = runDeploy({}, ['--changed=README.md']);

    expect(existsSync(npmCallsFile)).toBe(false);
    void r;
  });
});
