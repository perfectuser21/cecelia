/**
 * bluegreen-green-url.test.js — 回归测试（2026-07-15 Gate3 全红根因）
 *
 * 根因：webhook 链路 brain-deploy.sh 在 cecelia-node-brain 容器内执行，
 * pre-swap smoke 用 BRAIN_URL=http://localhost:5223 探 green，但 green 发布端口
 * 在宿主且 green 起在默认 bridge（blue 在 cecelia_default）→ 容器内秒拒，
 * 4/5 smoke 必挂 → 自动部署永远失败（手动宿主跑则可达全过）。
 *
 * 不变量：
 *  1. green docker run 必须带 --network <blue 所在网络>
 *  2. localhost:TEMP_PORT 不可达而 green_ip 可达时，smoke 的 BRAIN_URL = http://<green_ip>:5221
 *  3. localhost:TEMP_PORT 可达（宿主模式）时，smoke 的 BRAIN_URL = http://localhost:5223（回归保护）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BG_LIB = resolve(REPO_ROOT, 'scripts/lib/bluegreen.sh');
const GREEN_IP = '192.168.97.99';

function makeMocks(dir, { curlOkPattern }) {
  const dockerLog = join(dir, 'docker.log');
  const curlLog = join(dir, 'curl.log');
  writeFileSync(dockerLog, '');
  writeFileSync(curlLog, '');
  const docker = `#!/usr/bin/env bash
echo "$@" >> "${dockerLog}"
case "$1" in
  inspect)
    if echo "$@" | grep -q 'IPAddress'; then echo "${GREEN_IP}"; exit 0; fi
    if echo "$@" | grep -q 'NetworkSettings.Networks'; then echo "cecelia_default "; exit 0; fi
    if echo "$@" | grep -q 'State.Status'; then echo "running"; exit 0; fi
    if echo "$@" | grep -q 'State.Health'; then echo "healthy"; exit 0; fi
    echo "sha256:fake"; exit 0 ;;
  *) exit 0 ;;
esac
`;
  const curl = `#!/usr/bin/env bash
URL=""
for a in "$@"; do case "$a" in http*) URL="$a";; esac; done
echo "$URL" >> "${curlLog}"
echo "$URL" | grep -q "${curlOkPattern}" && exit 0
exit 7
`;
  writeFileSync(join(dir, 'docker'), docker); chmodSync(join(dir, 'docker'), 0o755);
  writeFileSync(join(dir, 'curl'), curl); chmodSync(join(dir, 'curl'), 0o755);
  return { dockerLog, curlLog };
}

function makeDeployRoot(dir) {
  const root = join(dir, 'deployroot');
  mkdirSync(join(root, 'packages/quality'), { recursive: true });
  mkdirSync(join(root, 'packages/brain/scripts/smoke'), { recursive: true });
  writeFileSync(join(root, 'packages/quality/smoke-core.txt'), 'echo-brain-url-smoke.sh\n');
  const resultFile = join(dir, 'smoke-brain-url.txt');
  writeFileSync(
    join(root, 'packages/brain/scripts/smoke/echo-brain-url-smoke.sh'),
    `#!/usr/bin/env bash\necho "\${BRAIN_URL:-UNSET}" > "${resultFile}"\nexit 0\n`
  );
  chmodSync(join(root, 'packages/brain/scripts/smoke/echo-brain-url-smoke.sh'), 0o755);
  return { root, resultFile };
}

function runSwap(dir, extraEnv = {}) {
  const fakeHome = join(dir, 'home');
  const credentialFile = join(dir, 'cecelia-internal.env');
  mkdirSync(fakeHome, { recursive: true });
  writeFileSync(credentialFile, `CECELIA_INTERNAL_TOKEN=${'a'.repeat(64)}\n`);
  return execSync(
    `bash -c 'source "${BG_LIB}" && TARGET_VERSION=9.9.9 TEMP_PORT=5223 HEALTH_TIMEOUT=6 bluegreen_swap'`,
    {
      env: {
        ...process.env,
        ...extraEnv,
        CECELIA_INTERNAL_ENV_FILE: credentialFile,
        PATH: `${dir}:${process.env.PATH}`,
        HOME: fakeHome,
      },
      encoding: 'utf8',
    }
  );
}

describe('bluegreen GREEN_URL 双模式（Gate3 全红根因回归）', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bg-url-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('green docker run 带 --network <blue 所在网络>', () => {
    const { dockerLog } = makeMocks(dir, { curlOkPattern: 'localhost:5223' });
    const { root } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    const runLine = readFileSync(dockerLog, 'utf8').split('\n')
      .find((l) => l.startsWith('run ') && l.includes('cecelia-node-brain-green'));
    expect(runLine).toBeTruthy();
    expect(runLine).toContain('--network cecelia_default');
  });

  it('容器模式：localhost 不可达 → smoke BRAIN_URL 用 green_ip:5221', () => {
    makeMocks(dir, { curlOkPattern: `${GREEN_IP}:5221` });
    const { root, resultFile } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    expect(existsSync(resultFile)).toBe(true);
    expect(readFileSync(resultFile, 'utf8').trim()).toBe(`http://${GREEN_IP}:5221`);
  });

  it('宿主模式：localhost 可达 → smoke BRAIN_URL 保持 localhost:5223（回归保护）', () => {
    makeMocks(dir, { curlOkPattern: 'localhost:5223' });
    const { root, resultFile } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    expect(existsSync(resultFile)).toBe(true);
    expect(readFileSync(resultFile, 'utf8').trim()).toBe('http://localhost:5223');
  });
});
