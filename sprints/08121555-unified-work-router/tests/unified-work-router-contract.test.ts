import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Unified Work Router 合同 [BEHAVIOR]', () => {
  it('四档 change_kind 只作正向映射', async () => {
    const { selectPipeline } = await import('../../../packages/brain/src/work-router.js');
    expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'new_capability' }))
      .toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: 'new-capability-v1' });
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' }))
      .toThrow('change_kind_required');
  });

  it('credential-bearing origin 归一化、日志脱敏且 active workspace cleanup 保护', async () => {
    const { canonicalizeRepositoryOrigin, redactRepositoryOrigin } = await import('../../../packages/brain/src/orchestrator/workspace-origin.js');
    const { ensureHarnessWorktree } = await import('../../../packages/brain/src/harness-worktree.js');
    const root = await mkdtemp(join(tmpdir(), 'router-origin-red-'));
    const remote = join(root, 'remote.git');
    const workspace = join(root, 'active-detached');
    execFileSync('git', ['init', '--bare', remote]);
    await mkdir(workspace);
    await writeFile(join(workspace, '.active-kernel-run.json'), JSON.stringify({ run_id: 'run-active', attempt_id: 'attempt-active', status: 'running' }));
    const secret = 'ghp_contract_secret';
    expect(canonicalizeRepositoryOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`))
      .toBe(canonicalizeRepositoryOrigin('https://github.com/perfectuser21/cecelia.git'));
    expect(redactRepositoryOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`)).not.toContain(secret);
    await ensureHarnessWorktree({ taskId: 'ws1', wtPath: workspace, cloneSource: remote, activeRun: { run_id: 'run-active', attempt_id: 'attempt-active' }, logFn: (line: string) => expect(line).not.toContain(secret) });
    await access(join(workspace, '.active-kernel-run.json'));
  });

  it('stale Map 在 Provider 前失败关闭', async () => {
    const { evaluateMapImpactPreflight } = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(evaluateMapImpactPreflight({ freshness: 'stale', repo: 'perfectuser21/cecelia', baselineRevision: 'a', sourceRevision: 'a' }))
      .toMatchObject({ ok: false, reason_code: 'map_stale', provider_attempt_created: false });
  });

  it('Generator trust boundary 必须由真实 runner 容器测试执行', async () => {
    await expect(access('docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.container.test.sh')).resolves.toBeUndefined();
  });
});
