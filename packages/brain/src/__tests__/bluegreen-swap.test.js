/**
 * bluegreen-swap.test.js — 回归测试（根治 2026-07-05 生产 Brain outage）
 *
 * 核心不变量：green canary 健康检查失败时，绝不删 blue(cecelia-node-brain)。
 * 用 mock docker（PATH 注入）驱动，不依赖真 docker。HOME 覆盖到临时目录，防止
 * send_bark 读到真实 ~/.credentials/bark.env 发出真实推送。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BG_LIB = resolve(REPO_ROOT, 'scripts/lib/bluegreen.sh');

// mock docker：每次调用参数追加写 $DOCKER_LOG；inspect 返回 greenHealthy 决定的健康态
function makeMockDocker(dir, { greenHealthy }) {
  const log = join(dir, 'docker.log');
  const script = `#!/usr/bin/env bash
echo "$@" >> "${log}"
case "$1" in
  run) exit 0 ;;
  inspect) echo "${greenHealthy ? 'healthy' : 'unhealthy'}"; exit 0 ;;
  rm|stop|compose|kill) exit 0 ;;
  *) exit 0 ;;
esac
`;
  const bin = join(dir, 'docker');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  writeFileSync(log, ''); // 预建空 log，实现缺失时失败为断言级而非 ENOENT
  return log;
}

function runSwap(dir, log) {
  // HOME=dir → 无 bark.env，send_bark 静默跳过；PATH 前置 mock docker
  let code = 0;
  let stdout = '';
  try {
    stdout = execSync(
      `bash -c 'source "${BG_LIB}"; BLUE_NAME=cecelia-node-brain GREEN_NAME=cecelia-node-brain-green ` +
        `TEMP_PORT=5223 TARGET_VERSION=9.9.9 HEALTH_TIMEOUT=2 bluegreen_swap'`,
      { env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: log }, stdio: 'pipe' }
    ).toString();
  } catch (e) {
    code = e.status || 1;
    stdout = (e.stdout || '').toString();
  }
  return { code, stdout, calls: readFileSync(log, 'utf8') };
}

describe('bluegreen_swap', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bg-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('green 健康检查失败时，绝不删 blue(cecelia-node-brain)，且 return 非0', () => {
    const log = makeMockDocker(tmp, { greenHealthy: false });
    const { code, calls } = runSwap(tmp, log);
    // 核心：blue 未被 rm -f（排除 green 的 -green 后缀）
    expect(calls).not.toMatch(/rm -f cecelia-node-brain(?!-green)/);
    // green 被起 + 被清理
    expect(calls).toMatch(/run .*cecelia-node-brain-green/);
    expect(calls).toMatch(/rm -f cecelia-node-brain-green/);
    // 失败返回非0
    expect(code).not.toBe(0);
  });

  it('green 健康时，才删 blue 并 return 0', () => {
    const log = makeMockDocker(tmp, { greenHealthy: true });
    const { code, calls } = runSwap(tmp, log);
    expect(calls).toMatch(/rm -f cecelia-node-brain(?!-green)/); // blue 被删
    expect(code).toBe(0);
  });

  it('send_bark 在无 jq 的 PATH 下 source + 调用不非零退出（无 BARK_TOKEN 静默跳过）', () => {
    // PATH 仅保留 /usr/bin:/bin，排除任何带 jq 的目录
    let code = 0;
    let stdout = '';
    try {
      stdout = execSync(
        `bash -c 'set -e; source "${BG_LIB}"; send_bark "test-no-jq"'`,
        {
          env: { ...process.env, HOME: tmp, PATH: '/usr/bin:/bin' },
          stdio: 'pipe',
        }
      ).toString();
    } catch (e) {
      code = e.status || 1;
      stdout = (e.stdout || '').toString() + (e.stderr || '').toString();
    }
    expect(code).toBe(0);
    expect(stdout).toMatch(/跳过推送|已推送|推送失败/);
  });
});
