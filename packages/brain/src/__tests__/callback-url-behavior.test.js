import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const { createDockerAdapter } = createRequire(import.meta.url)('../../scripts/fleet-worker/attempt-runner.cjs');
const entrypoint = readFileSync(new URL('../../../../docker/cecelia-runner/entrypoint.sh', import.meta.url), 'utf8');
const selection = entrypoint.slice(entrypoint.indexOf('TARGET_URL="${HARNESS_CALLBACK_URL:-}"'), entrypoint.indexOf('\nCALLBACK_OK=0'));
const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function adapter() {
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'callback-behavior-'));
  roots.push(runtimeRoot);
  const runCommand = vi.fn(async () => ({ stdout: 'd'.repeat(64) }));
  return { runCommand, docker: createDockerAdapter({ workerId: 'us-mac-m4', runtimeRoot, runCommand, resolveMountSource: source => source }) };
}
function input(url) {
  return {
    attemptId: '22222222-2222-4222-8222-222222222222', runId: '11111111-1111-4111-8111-111111111111',
    workerId: 'us-mac-m4', image: `cecelia/runner@sha256:${'a'.repeat(64)}`,
    providerSpec: { provider: 'claude', stdin: 'fixture prompt' }, role: 'reporter', timeoutSeconds: 30,
    workspaceMount: { source: '/fixture/worktree', target: '/workspace', readOnly: true },
    workspaceAdminMount: { source: '/fixture/mirror', target: '/fixture/mirror', readOnly: true },
    labels: {}, callback: { url, token: 'fixture-callback-token' }, lease: { owner: 'fixture-owner', generation: 7 },
  };
}
function selectedUrl(env) {
  return execFileSync('/bin/bash', ['-eu', '-c', `${selection}\nprintf '%s' "$TARGET_URL"`], {
    env: { PATH: '/usr/bin:/bin', HOSTNAME: 'docker-generated-hostname', ...env }, encoding: 'utf8',
  });
}

function recordedCallback(env, httpStatus = '200', exitCode = '23') {
  const root = mkdtempSync(join(tmpdir(), 'callback-curl-'));
  roots.push(root);
  const argvFile = join(root, 'curl.argv');
  const bodyFile = join(root, 'result.json');
  const body = JSON.stringify({ result: 'failed', exit_code: Number(exitCode), summary: '引号"与换行\n原样交付' });
  writeFileSync(bodyFile, body);
  // 只运行原入口最后的回调分支；不运行provider、配置复制或容器初始化。
  const start = entrypoint.indexOf('if [[ $PROVIDER_CONTRACT -eq 1 ]]; then\n  CALLBACK_BODY=');
  if (start < 0) throw new Error('entrypoint callback branch missing');
  const callback = entrypoint.slice(start);
  // PATH只有替身目录，所有curl参数原样以NUL记录；永不调用真实curl。
  writeFileSync(join(root, 'curl'), '#!/bin/bash\nprintf "%s\\0" "$@" >> "$ARGV_FILE"\nprintf "%s" "$HTTP_STATUS"\n', { mode: 0o700 });
  writeFileSync(join(root, 'cat'), '#!/bin/bash\nexec /bin/cat "$@"\n', { mode: 0o700 });
  writeFileSync(join(root, 'sleep'), '#!/bin/bash\nexit 97\n', { mode: 0o700 });
  const result = spawnSync('/bin/bash', ['-eu', '-c', callback], {
    env: { PATH: root, ARGV_FILE: argvFile, HTTP_STATUS: httpStatus,
      PROVIDER_CONTRACT: '1', NORMALIZED_RESULT_FILE: bodyFile, EXIT_CODE: exitCode,
      HOSTNAME: 'docker-generated-hostname', ...env },
    encoding: 'utf8', timeout: 2000,
  });
  if (result.error) throw result.error;
  return { result, body, args: readFileSync(argvFile, 'utf8').split('\0').slice(0, -1) };
}

describe('Fleet回调地址的真实交付与entrypoint选择', () => {
  it('Docker参数交付完整URL，entrypoint优先它而不是容器HOSTNAME', async () => {
    const url = 'http://127.0.0.1:19222/api/brain/harness/attempts/fixture/callback';
    const { docker, runCommand } = adapter();
    await docker.prepare(input(url));
    const args = runCommand.mock.calls.find(([command, args]) => command === 'docker' && args[0] === 'create')[1];
    expect(args).toContain(`HARNESS_CALLBACK_URL=${url}`);
    expect(args).toContain('HARNESS_LEASE_OWNER=fixture-owner');
    expect(args).toContain('HARNESS_LEASE_GENERATION=7');
    expect(args).toContain('BRAIN_URL=http://127.0.0.1:19222');
    expect(selectedUrl({ HARNESS_CALLBACK_URL: url })).toBe(url);
  });

  it('未提供完整URL时只在兼容路径中使用HOSTNAME', () => {
    expect(selectedUrl({})).toBe('http://host.docker.internal:5221/api/brain/harness/callback/docker-generated-hostname');
  });

  it('不可解析的回调地址在任何外部命令前拒绝', async () => {
    const { docker, runCommand } = adapter();
    await expect(docker.prepare(input('not an absolute URL'))).rejects.toThrow('attempt_callback_url_invalid');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['显式地址', { HARNESS_CALLBACK_URL: 'http://127.0.0.1:19222/callback/fixture' }, 'http://127.0.0.1:19222/callback/fixture'],
    ['HOSTNAME兼容地址', {}, 'http://host.docker.internal:5221/api/brain/harness/callback/docker-generated-hostname'],
  ])('%s最终被真实curl调用消费，成功回执保留provider失败码和完整payload', (_name, env, expectedUrl) => {
    const { result, args, body } = recordedCallback(env);
    expect(result.status, result.stderr).toBe(23);
    expect(args[args.indexOf('-X') + 1]).toBe('POST');
    expect(args[args.indexOf('POST') + 1]).toBe(expectedUrl);
    expect(args[args.indexOf('-d') + 1]).toBe(body);
    expect(args.filter(value => value === '-X')).toHaveLength(1);
    expect(result.stdout).toContain('harness callback POST ok');
  });

  it('永久HTTP拒绝传出75并携带实际attempt租约头，不能伪称回执成功', () => {
    const { result, args, body } = recordedCallback({
      HARNESS_CALLBACK_URL: 'http://127.0.0.1:19222/callback/rejected',
      HARNESS_ATTEMPT_ID: 'fixture-attempt', HARNESS_CALLBACK_TOKEN: 'fixture-token',
      HARNESS_LEASE_OWNER: 'fixture-owner', HARNESS_LEASE_GENERATION: '7',
    }, '403', '0');
    expect(result.status, result.stderr).toBe(75);
    expect(args[args.indexOf('POST') + 1]).toBe('http://127.0.0.1:19222/callback/rejected');
    expect(args[args.indexOf('-d') + 1]).toBe(body);
    expect(args).toEqual(expect.arrayContaining(['Authorization: Bearer fixture-token', 'X-Harness-Lease-Owner: fixture-owner', 'X-Harness-Lease-Generation: 7']));
    expect(args.filter(value => value === '-X')).toHaveLength(1);
    expect(result.stderr).toContain('permanent rejection http=403');
    expect(result.stdout).not.toContain('callback POST ok');
  });
});
