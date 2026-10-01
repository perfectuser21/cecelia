// F1 步骤 1：恢复重派也必须先确认旧执行停止，才能转移机器预约。
// 真连接 replacement → cleanup → Docker inspect 语义；仅替换数据库和系统命令边界。
// SQL 的原子占位/确认释放由 attempt-weighted-reservation.pg.integration.test.js 验证。
import { describe, expect, it, vi } from 'vitest';
import { reserveExpiredAttemptReplacement } from '../../../packages/brain/src/orchestrator/attempt-resource-replacement.js';
import { confirmExpiredParentCleanup, inspectLocalContainer } from '../../../packages/brain/src/orchestrator/attempt-resource-cleanup.js';

const parent = {
  id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  role: 'generator', status: 'running', actual_machine_id: 'us-mac-m4',
  lease_owner: 'old-worker', lease_generation: 3,
  execution_transport: 'local-docker', local_container_naming: 'legacy-unsuffixed',
};
const containerId = 'cecelia-harness-11111111';

function replacementBoundary() {
  const client = {
    query: vi.fn(async (sql) => {
      if (sql.includes('SELECT * FROM harness_attempts')) return { rows: [{ ...parent }] };
      if (/^(BEGIN|ROLLBACK|SELECT)/.test(sql.trim())) return { rows: [] };
      throw new Error('unconfirmed_cleanup_must_not_mutate_attempts');
    }),
    release: vi.fn(),
  };
  return {
    client,
    input: {
      pool: { connect: async () => client }, parentAttempt: parent,
      childInput: { runId: parent.run_id, role: parent.role, machineId: parent.actual_machine_id },
      collectSnapshot: async () => ({
        verified: true, machine: parent.actual_machine_id, expires_at: Date.now() + 30_000,
        capacity: { ok: true, physical_base_slots: 7, effective_base_slots: 7 },
      }),
    },
  };
}

describe('F1 step1 — 旧执行未确认停止时不转移机器预约', () => {
  it.each([
    ['删除返回成功但精确容器仍存在', async () => ({}), 'replacement_cleanup_unconfirmed'],
    ['Docker 不可达', async () => { throw Object.assign(new Error('daemon unavailable'), { code: 1, stderr: 'Cannot connect to Docker daemon' }); }, 'daemon unavailable'],
    ['不存在回执属于另一个容器', async () => { throw Object.assign(new Error('wrong container'), { code: 1, stderr: 'Error: No such object: another-container' }); }, 'wrong container'],
  ])('%s：回滚并保留父执行预约', async (_label, execFileFn, expectedError) => {
    const { client, input } = replacementBoundary();
    const removeContainer = vi.fn(async () => true);
    // fleet-worker 空 state 的 already_clean 不能证明 legacy 容器已经停止。
    const launcher = { cancel: vi.fn(async () => ({ status: 'already_clean', attempt_id: parent.id })) };
    const inspect = vi.fn(execFileFn);
    await expect(reserveExpiredAttemptReplacement({
      ...input,
      confirmCleanup: (locked) => confirmExpiredParentCleanup(locked, {
        env: { CECELIA_MACHINE_ID: 'us-mac-m4' }, launcher, removeContainer,
        inspectContainer: (id) => inspectLocalContainer(id, { execFileFn: inspect }),
      }),
    })).rejects.toThrow(expectedError);

    expect(removeContainer).toHaveBeenCalledWith(containerId);
    expect(inspect).toHaveBeenCalledWith('docker', ['inspect', '--format', '{{.Name}}', containerId], { timeout: 5000 });
    expect(launcher.cancel).not.toHaveBeenCalled();
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.some((sql) => /\b(UPDATE|INSERT|DELETE|COMMIT)\b/.test(sql.replace('FOR UPDATE', '')))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('重复清理以精确不存在证明重新确认，不能只依赖删除命令返回值', async () => {
    const options = {
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' }, removeContainer: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      inspectContainer: (id) => inspectLocalContainer(id, { execFileFn: async () => {
        throw Object.assign(new Error('missing'), { code: 1, stderr: `Error: No such object: ${id}\n` });
      } }),
    };
    expect(await confirmExpiredParentCleanup(parent, options)).toEqual({ status: 'cleaned', attempt_id: parent.id });
    expect(await confirmExpiredParentCleanup(parent, options)).toEqual({ status: 'already_clean', attempt_id: parent.id });
    expect(options.removeContainer.mock.calls).toEqual([[containerId], [containerId]]);
  });
});
