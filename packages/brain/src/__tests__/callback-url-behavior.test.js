import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
});
