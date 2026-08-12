import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, access, readFile } from 'node:fs/promises';
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
    const seed = join(root, 'seed');
    const workspace = join(root, 'active-detached');
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['clone', remote, seed]);
    execFileSync('git', ['-C', seed, 'config', 'user.email', 'harness@example.invalid']);
    execFileSync('git', ['-C', seed, 'config', 'user.name', 'Harness']);
    await writeFile(join(seed, 'README.md'), 'seed\n');
    execFileSync('git', ['-C', seed, 'add', 'README.md']);
    execFileSync('git', ['-C', seed, 'commit', '-m', 'seed']);
    execFileSync('git', ['-C', seed, 'branch', '-M', 'main']);
    execFileSync('git', ['-C', seed, 'push', 'origin', 'main']);
    execFileSync('git', ['clone', '--branch', 'main', remote, workspace]);
    execFileSync('git', ['-C', workspace, 'checkout', '--detach', 'HEAD']);
    const secret = 'ghp_contract_secret';
    const cleanOrigin = 'https://github.com/perfectuser21/cecelia.git';
    const credentialOrigin = `https://contract-user:${secret}@github.com/perfectuser21/cecelia.git`;
    execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', credentialOrigin]);
    await writeFile(join(workspace, 'active-sentinel'), 'must-survive\n');
    const activeRun = { run_id: 'run-active', attempt_id: 'attempt-active', workspace_path: workspace, status: 'running' };
    await writeFile(join(workspace, '.active-kernel-run.json'), JSON.stringify(activeRun));
    const logs: string[] = [];

    expect(canonicalizeRepositoryOrigin(credentialOrigin)).toBe(canonicalizeRepositoryOrigin(cleanOrigin));
    expect(redactRepositoryOrigin(credentialOrigin)).not.toMatch(/contract-user|ghp_contract_secret/);
    for (let pass = 0; pass < 2; pass += 1) {
      const result = await ensureHarnessWorktree({
        taskId: 'b0443bf7-001f-4ae3-9b3b-4c7178bbcd49',
        baseRepo: remote,
        wtPath: workspace,
        activeRun,
        activeInitiativeRuns: [activeRun],
        logFn: (line: string) => logs.push(String(line)),
      });
      expect(result).toBe(workspace);
      await access(join(workspace, '.git'));
      expect(await readFile(join(workspace, 'active-sentinel'), 'utf8')).toBe('must-survive\n');
    }
    expect(logs.join('\n')).not.toMatch(/contract-user|ghp_contract_secret/);
    expect(logs.join('\n')).not.toContain(credentialOrigin);
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
