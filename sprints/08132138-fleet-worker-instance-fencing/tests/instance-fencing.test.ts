// TDD Red artifact — Fleet Worker 实例互杀防护 + contract→runtime 投影
// 覆盖 Golden Path Step 1/2/3/4（场景 A/B/D 的逻辑层）。真 Docker 双 data root 与真 PG
// lineage/幂等 分别由 ## E2E 验收 与 kernel-instance-fencing-lineage.pg.integration.test.js 复演。
// 这些断言针对本 sprint 尚未实现的 API，当前应全部 FAIL（Red）。
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const FW = '../../../packages/brain/scripts/fleet-worker';
const { createWorkspaceManager } = require(`${FW}/workspace-manager.cjs`);
const { createAttemptResourceManager } = require(`${FW}/attempt-resources.cjs`);
const attemptRunner = require(`${FW}/attempt-runner.cjs`);

const PG_DIGEST = `postgres:16-alpine@sha256:${'f'.repeat(64)}`;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';

function makeManager(base: string) {
  const roots = {
    mirrorRoot: join(base, 'm'),
    worktreeRoot: join(base, 'w'),
    quarantineRoot: join(base, 'q'),
    repoAllowlist: { 'perfectuser21/cecelia': 'https://github.com/perfectuser21/cecelia.git' },
  };
  for (const k of ['mirrorRoot', 'worktreeRoot', 'quarantineRoot'] as const) {
    mkdirSync((roots as any)[k], { recursive: true });
  }
  return createWorkspaceManager(roots);
}

describe('Fleet Worker instance fencing', () => {
  it('persists a restart-stable namespace anchored to the data root', () => {
    const base = mkdtempSync(join(tmpdir(), 'fleet-ns-'));
    const m1 = makeManager(base);
    const a = m1.resolveInstanceNamespace();
    const b = m1.resolveInstanceNamespace();
    const m2 = makeManager(base); // 模拟 Worker 重启：同 roots 新实例从持久化读
    const c = m2.resolveInstanceNamespace();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(a).toBe(c);
    // 不同 data root 必须得不同 namespace（否则无法区分同机两 Worker）
    const other = makeManager(mkdtempSync(join(tmpdir(), 'fleet-ns-')));
    expect(other.resolveInstanceNamespace()).not.toBe(a);
  });

  it('reconcile does not reap other-instance containers/networks', async () => {
    const removed: string[] = [];
    const runCommand = async (cmd: string, args: string[]) => {
      if (args[0] === 'ps') {
        return { stdout: `cecelia-pg-${A}\t${A}\tns-A\ncecelia-pg-${B}\t${B}\tns-B` };
      }
      if (args[0] === 'network' && args[1] === 'ls') {
        return { stdout: `cecelia-attempt-${A}\t${A}\tns-A\ncecelia-attempt-${B}\t${B}\tns-B` };
      }
      if (args[0] === 'rm' || (args[0] === 'network' && args[1] === 'rm')) removed.push(args.join(' '));
      return { stdout: '' };
    };
    const m = createAttemptResourceManager({ runCommand, instanceNamespace: 'ns-A', postgresImageDigest: PG_DIGEST });
    const r = await m.reconcile({ retainedAttemptIds: [] });
    expect(r.removed_attempts).not.toContain(B);
    expect(removed.some((x) => x.includes(B))).toBe(false);
    expect(r.removed_attempts).toContain(A);
  });

  it('reconcile is fail-closed on legacy no-namespace containers', async () => {
    const removed: string[] = [];
    const runCommand = async (cmd: string, args: string[]) => {
      if (args[0] === 'ps') return { stdout: `cecelia-pg-${OLD}\t${OLD}\t` }; // instance 标签为空 = 旧容器
      if (args[0] === 'network' && args[1] === 'ls') return { stdout: '' };
      if (args[0] === 'rm' || (args[0] === 'network' && args[1] === 'rm')) removed.push(args.join(' '));
      return { stdout: '' };
    };
    const m = createAttemptResourceManager({ runCommand, instanceNamespace: 'ns-A', postgresImageDigest: PG_DIGEST });
    const r = await m.reconcile({ retainedAttemptIds: [] });
    expect(r.removed_attempts).not.toContain(OLD);
    expect(removed).toHaveLength(0);
    expect(Array.isArray(r.fail_closed) && r.fail_closed.includes(OLD)).toBe(true);
  });

  it('projects contract_requirements.postgres to runtime_resources.postgres', () => {
    const on = attemptRunner.projectContractRequirements({ contract_requirements: { postgres: true } });
    expect(on.runtime_resources.postgres).toBe(true);
    const off = attemptRunner.projectContractRequirements({ contract_requirements: { postgres: false } });
    expect(off.runtime_resources.postgres).toBe(false);
  });
});
