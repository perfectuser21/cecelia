/**
 * bluegreen-swap.test.js — 回归测试（根治 2026-07-05 + 2026-07-10 生产 Brain outage）
 *
 * 核心不变量：
 *  1. green canary 健康检查失败时，绝不删 blue(cecelia-node-brain)
 *  2. 失败路径调用 bluegreen_guard_blue，检测并恢复意外停止的 blue 容器
 *  3. 成功路径先启动 compose sidecar 再删 blue（规避自杀竞态）
 *  4. sidecar 启动失败时不删 blue（fail-safe）
 * 用 mock docker（PATH 注入）驱动，不依赖真 docker。HOME 覆盖到临时目录，防止
 * send_bark 读到真实 ~/.credentials/bark.env 发出真实推送。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BG_LIB = resolve(REPO_ROOT, 'scripts/lib/bluegreen.sh');

/**
 * makeMockDocker: 注入 PATH，让 docker 命令走 mock 脚本
 * opts:
 *  greenHealthy: bool — inspect 返回 healthy/unhealthy
 *  blueState: string — guard 调用 inspect --format '{{.State.Status}}' 时的返回值
 *  sidecarFails: bool — docker run sidecar 时返回 exit 1
 */
function makeMockDocker(dir, { greenHealthy, blueState = 'running', sidecarFails = false }) {
  const log = join(dir, 'docker.log');
  // mock docker：区分 inspect 的 format 参数来区分 green health 和 blue state
  const script = `#!/usr/bin/env bash
echo "$@" >> "${log}"
case "$1" in
  run)
    # sidecar run 失败控制
    if [[ "${sidecarFails}" == "true" ]] && echo "$@" | grep -q "cecelia-bluegreen-sidecar"; then
      exit 1
    fi
    exit 0
    ;;
  inspect)
    # bluegreen_guard_blue 用 --format '{{.State.Status}}'
    if echo "$@" | grep -q 'State.Status'; then
      echo "${blueState}"
    else
      # bluegreen_swap poll 用 '{{if .State.Health}}...'
      echo "${greenHealthy ? 'healthy' : 'unhealthy'}"
    fi
    exit 0
    ;;
  start) exit 0 ;;
  rm|stop|compose|kill) exit 0 ;;
  *) exit 0 ;;
esac
`;
  const bin = join(dir, 'docker');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  writeFileSync(log, ''); // 预建空 log
  return log;
}

function runSwap(dir, log, extraEnv = {}) {
  let code = 0;
  let stdout = '';
  try {
    stdout = execSync(
      `bash -c 'source "${BG_LIB}"; BLUE_NAME=cecelia-node-brain GREEN_NAME=cecelia-node-brain-green ` +
        `TEMP_PORT=5223 TARGET_VERSION=9.9.9 HEALTH_TIMEOUT=2 bluegreen_swap'`,
      {
        env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: log, ...extraEnv },
        stdio: 'pipe',
      }
    ).toString();
  } catch (e) {
    code = e.status || 1;
    stdout = (e.stdout || '').toString();
  }
  return { code, stdout, calls: readFileSync(log, 'utf8') };
}

function runGuard(dir, log, containerName = 'cecelia-node-brain') {
  let code = 0;
  let stdout = '';
  try {
    stdout = execSync(
      `bash -c 'source "${BG_LIB}"; bluegreen_guard_blue "${containerName}"'`,
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

  it('green 健康时，sidecar 未设置则直接删 blue 并 return 0', () => {
    const log = makeMockDocker(tmp, { greenHealthy: true });
    // 不设 DEPLOY_ROOT_DIR → 无 sidecar，走旧路径
    const { code, calls } = runSwap(tmp, log);
    expect(calls).toMatch(/rm -f cecelia-node-brain(?!-green)/); // blue 被删
    expect(code).toBe(0);
  });

  it('green 健康+DEPLOY_ROOT_DIR 设置时，sidecar 在 blue rm 之前被调用', () => {
    const log = makeMockDocker(tmp, { greenHealthy: true, sidecarFails: false });
    // 创建伪 deploy root 含 docker-compose.yml
    const deployRoot = mkdtempSync(join(tmpdir(), 'deploy-root-'));
    writeFileSync(join(deployRoot, 'docker-compose.yml'), 'name: cecelia\nservices: {}\n');
    try {
      const { code, calls } = runSwap(tmp, log, { DEPLOY_ROOT_DIR: deployRoot });
      // sidecar 应该被启动（docker run 含 cecelia-bluegreen-sidecar）
      expect(calls).toMatch(/cecelia-bluegreen-sidecar/);
      // sidecar 出现在 blue rm 之前
      const sidecarIdx = calls.indexOf('cecelia-bluegreen-sidecar');
      const blueRmMatch = calls.match(/rm -f cecelia-node-brain(\n|$)/m);
      if (blueRmMatch) {
        expect(sidecarIdx).toBeLessThan(blueRmMatch.index);
      }
      // 最终 blue 被删（sidecar 已起，可以安全删 blue）
      expect(calls).toMatch(/rm -f cecelia-node-brain(\n|$)/m);
      expect(code).toBe(0);
    } finally {
      rmSync(deployRoot, { recursive: true, force: true });
    }
  });

  it('sidecar 启动失败时，blue 不被删除（fail-safe）', () => {
    const log = makeMockDocker(tmp, { greenHealthy: true, sidecarFails: true });
    const deployRoot = mkdtempSync(join(tmpdir(), 'deploy-root-'));
    writeFileSync(join(deployRoot, 'docker-compose.yml'), 'name: cecelia\nservices: {}\n');
    try {
      const { code, calls } = runSwap(tmp, log, { DEPLOY_ROOT_DIR: deployRoot });
      // sidecar 被尝试但失败
      expect(calls).toMatch(/cecelia-bluegreen-sidecar/);
      // blue 不应被删除（fail-safe）
      expect(calls).not.toMatch(/rm -f cecelia-node-brain(\n|$)/m);
      // 失败返回非0
      expect(code).not.toBe(0);
    } finally {
      rmSync(deployRoot, { recursive: true, force: true });
    }
  });

  it('send_bark 在无 jq 的 PATH 下 source + 调用不非零退出（无 BARK_TOKEN 静默跳过）', () => {
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

describe('bluegreen_guard_blue', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bg-guard-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('blue 正在运行时，guard 不调用 docker start 且不报错', () => {
    const log = makeMockDocker(tmp, { greenHealthy: false, blueState: 'running' });
    const { code, stdout, calls } = runGuard(tmp, log);
    expect(code).toBe(0);
    expect(stdout).toMatch(/✅.*仍在运行/);
    expect(calls).not.toMatch(/start cecelia-node-brain/);
  });

  it('blue exited 时，guard 调用 docker start 恢复', () => {
    const log = makeMockDocker(tmp, { greenHealthy: false, blueState: 'exited' });
    const { stdout, calls } = runGuard(tmp, log);
    expect(calls).toMatch(/start cecelia-node-brain/);
    expect(stdout).toMatch(/docker start.*成功|尝试 docker start/);
  });

  it('blue missing 时，guard 输出告警（不崩溃）', () => {
    const log = makeMockDocker(tmp, { greenHealthy: false, blueState: 'missing' });
    const { code, stdout } = runGuard(tmp, log);
    // guard 本身不应崩溃（set -uo pipefail 下 || true 保护）
    expect(code).toBe(0);
    expect(stdout).toMatch(/容器不存在|蓝绿承诺被打破/);
  });

  it('失败路径 bluegreen_swap 调用 guard（green 起容器失败场景）', () => {
    // 构造让 green run 失败的 mock docker
    const log = join(tmp, 'docker.log');
    const script = `#!/usr/bin/env bash
echo "$@" >> "${log}"
case "$1" in
  run)
    if echo "$@" | grep -q "cecelia-node-brain-green"; then exit 1; fi
    exit 0
    ;;
  inspect)
    if echo "$@" | grep -q 'State.Status'; then echo "running"; else echo "unhealthy"; fi
    exit 0
    ;;
  rm|stop|start|compose|kill) exit 0 ;;
  *) exit 0 ;;
esac
`;
    const bin = join(tmp, 'docker');
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);
    writeFileSync(log, '');

    const { code, calls } = runSwap(tmp, log);
    // green 起失败 → swap 失败（return 1）
    expect(code).not.toBe(0);
    // guard 被调用：inspect 检查 blue state（--format 包含 State.Status）
    expect(calls).toMatch(/inspect.*State.Status.*cecelia-node-brain|inspect.*cecelia-node-brain.*State.Status/s);
    // blue 绝对未被 rm -f
    expect(calls).not.toMatch(/rm -f cecelia-node-brain(?!-green)/);
  });
});
