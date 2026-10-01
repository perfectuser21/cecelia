import { describe, expect, it } from 'vitest';
import {
  validateEnrollment, buildOnboardingScript, validateReceipt, onboardingView,
} from '../node-onboarding/spec.js';

const id = '68d1b8de-435c-4edb-b674-d13fefde0fa2';
const now = new Date('2026-10-01T06:00:00Z');
const input = {
  name: 'hk-worker-2', address: '192.0.2.10', ssh_user: 'operator', ssh_port: 22,
  credential_ref: 'op://CS/node-2/private key',
  host_key_fingerprint: `SHA256:${'a'.repeat(43)}`, role: 'observer', region: 'HK',
};
const receipt = () => ({
  type: 'node_onboarding_receipt', id, mode: 'enroll', name: input.name, verified: true,
  service: { enabled: true, active: true },
  health: {
    schema_version: 1, node_id: id, agent_version: '1', observed_at: now.toISOString(),
    sequence: 2, hostname: 'hk-worker-2', os: 'linux',
    resources: { memory_total_bytes: 8e9, memory_available_bytes: 4e9, cpu_load_1m: 0.4,
      cpu_cores: 4, disk_free_bytes: 10e9, disk_total_bytes: 40e9 },
    capabilities: { collector: true, janitor: true, execution: false },
  },
  steps: [{ key: 'verify', label: '健康验收', status: 'completed' }],
});
const task = (status = 'completed', report = receipt()) => ({
  id: '6d22e1b1-cf21-4d2b-baae-74fcf4775d20', status,
  completed_at: now.toISOString(),
  payload: { node_onboarding: { id, mode: 'enroll', request: input } },
  result: { script: { exit_code: 0, stdout: JSON.stringify(report) } },
});

describe('机器接入契约', () => {
  it('只接受结构化连接字段，不接受密钥或任意命令', () => {
    expect(validateEnrollment(input)).toEqual(input);
    for (const extra of [{ private_key: 'secret' }, { cmd: 'rm -rf /' }, { password: 'secret' }]) {
      expect(() => validateEnrollment({ ...input, ...extra })).toThrow();
    }
  });
  it.each([
    ['address', '127.0.0.1'], ['address', '169.254.169.254'], ['address', 'node;touch /tmp/pwn'],
    ['address', '-oProxyCommand=bad'], ['ssh_user', 'root;id'], ['ssh_port', 0],
    ['credential_ref', '/tmp/key'], ['host_key_fingerprint', 'trust-me'], ['role', 'root'],
    ['name', '../node'],
  ])('拒绝非法字段 %s=%s', (field, value) => {
    expect(() => validateEnrollment({ ...input, [field]: value })).toThrow();
  });
  it('把新机连接参数放入受校验环境变量，执行主机始终是受管主力机', () => {
    const spec = buildOnboardingScript(id, input, 'enroll', {
      host: 'us-mac-m4', runnerPath: '/opt/cecelia/scripts/ops/node-onboarding.mjs',
    });
    expect(spec.host).toBe('us-mac-m4');
    expect(spec.cmd).not.toContain(input.address);
    const data = JSON.parse(Buffer.from(spec.env.TASK_ONBOARDING_REQUEST, 'base64').toString());
    expect(data).toMatchObject({ ...input, id, mode: 'enroll' });
    expect(spec.timeout_sec).toBeGreaterThanOrEqual(180);
  });
});

describe('真实验收回执', () => {
  it('只有身份、服务、两次采样与指标都通过才接受', () => {
    expect(validateReceipt(task(), now).health.node_id).toBe(id);
  });
  it.each([
    r => { r.verified = false; },
    r => { r.id = 'another-node'; },
    r => { r.name = 'another-machine'; },
    r => { r.health.node_id = 'another-node'; },
    r => { r.health.sequence = 1; },
    r => { r.health.observed_at = '2026-10-01T05:50:00Z'; },
    r => { r.health.observed_at = '2026-10-01T06:02:00Z'; },
    r => { r.service.active = false; },
    r => { r.service.enabled = false; },
    r => { r.health.resources.memory_total_bytes = 0; },
    r => { r.health.resources.memory_available_bytes = null; },
    r => { r.health.capabilities.collector = false; },
  ])('拒绝不完整或不可信健康证据 #%#', mutate => {
    const r = receipt(); mutate(r);
    expect(() => validateReceipt(task('completed', r), now)).toThrow();
  });
  it('exit=0但没有回执时不能显示成功，也不能凭进行中的stdout成功', () => {
    const t = task(); t.result.script.stdout = 'done';
    expect(onboardingView(t, now)).toMatchObject({ status: 'failed', error: expect.any(String) });
    expect(onboardingView(task('in_progress'), now).status).toBe('in_progress');
  });
  it('历史接入按完成时刻验收，不因查看时间变化把成功改失败', () => {
    expect(onboardingView(task(), new Date('2026-10-02')).status).toBe('completed');
  });
  it('取消/失败保留终态且不泄漏脚本原始错误输出', () => {
    const t = task('failed'); t.error_message = 'private-key-secret';
    expect(onboardingView(t, now)).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(onboardingView(t, now))).not.toContain('private-key-secret');
    expect(onboardingView(task('cancelled'), now).status).toBe('cancelled');
  });
});
