import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const cli = new URL('../../scripts/generate-commander-skill.mjs', import.meta.url).pathname;
const activity = (key, order, phase = 'setup') => ({ key, name: key, order,
  budget: { max_duration_s: 120, heartbeat_s: 30 },
  failure: { empty_ok: [], retryable: ['temporary_transport'], fatal: ['identity_invalid'],
    needs_human: { cases: ['account_mismatch'] } },
  postconditions: [{ probe: `${key}_readback`, asserts: '真实产物存在' }],
  steps: [{ key: 'readback', name: '读回', check: '回执与真身一致' }],
  runtime: { phase, entry: 'activity.mjs', protocol: 'json-stdio-v1' } });
const envelope = () => ({ capability: 'fixture_flow',
  contract: { workflow: 'fixture-workflow', activities: [activity('cleanup', 2, 'finalize'), activity('preflight', 1)] },
  sop: { schema_version: 1, cases: [{ code: 'screen_asleep', observed: '屏幕确认为休眠',
    action: '只对调度单设备唤醒并读回，不重启执行器', verify: '屏幕亮且心跳仍属于同run',
    permission: 'automatic' }] } });
const run = input => spawnSync(process.execPath, [cli], { input: JSON.stringify(input), encoding: 'utf8' });

it('真实CLI生成确定性专属skill，按order保留预算、分类、探针与显式SOP', () => {
  const input = envelope(), result = run(input);
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.schema_version).toBe(1);
  expect(output.name).toBe('wf-fixture_flow');
  expect(output.contract_sha256).toBe(createHash('sha256').update(JSON.stringify(input.contract)).digest('hex'));
  expect(output.skill).toContain('commander_capability: fixture_flow');
  expect(output.skill.indexOf('## 1. preflight')).toBeLessThan(output.skill.indexOf('## 2. cleanup'));
  for (const text of ['120', '30', 'temporary_transport', 'identity_invalid', 'account_mismatch',
    'preflight_readback', '真实产物存在', '回执与真身一致', 'screen_asleep', '只对调度单设备唤醒',
    '不选机器', 'nonce', '不得自行 cron rm', '终态优先', '实际写回执时', '带时区']) expect(output.skill).toContain(text);
  expect(run(input).stdout).toBe(result.stdout);
});

it('删除活动后的变体不保留该活动预算、失败条目或探针', () => {
  const input = envelope(); input.contract.activities.push({ ...activity('scoring', 1.5, 'batch_end'),
    failure: { ...activity('x', 1).failure, retryable: ['score_only_failure'] } });
  expect(JSON.parse(run(input).stdout).skill).toContain('score_only_failure');
  input.contract.activities = input.contract.activities.filter(a => a.key !== 'scoring');
  const result = run(input); expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).skill).not.toMatch(/scoring|score_only_failure/);
});

it('监督既有shell契约不冒充JSON可执行契约，保留原入口与参数', () => {
  const input = envelope();
  input.contract.activities[0].runtime = { phase: 'finalize', entry: 'wf-run.sh', args: '原收尾trap' };
  const result = run(input); expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).skill).toContain('原收尾trap');
  expect(JSON.parse(result.stdout).skill).toContain('仅用于监督');
});

for (const mode of ['duplicate_order', 'missing_probe', 'invalid_capability', 'invalid_permission', 'unknown_case']) {
  it(`非法输入 ${mode} 拒绝生成，不输出可用skill`, () => {
    const input = envelope();
    if (mode === 'duplicate_order') input.contract.activities[0].order = 1;
    if (mode === 'missing_probe') input.contract.activities[0].postconditions = [];
    if (mode === 'invalid_capability') input.capability = '../other';
    if (mode === 'invalid_permission') input.sop.cases[0].permission = 'unlimited';
    if (mode === 'unknown_case') input.sop.cases[0].unexpected = '猜测';
    const result = run(input); expect(result.status).not.toBe(0);
    expect(result.stdout).toBe(''); expect(result.stderr).toContain('commander_skill_invalid');
  });
}
