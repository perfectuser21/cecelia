import { describe, it, expect, vi } from 'vitest';

// @ts-expect-error: lib not yet implemented (red phase)
import * as injA from '../../../harness-acceptance-v3/lib/inject-docker-sigkill.mjs';

describe('Workstream 3 — 故障注入 A: Docker SIGKILL [BEHAVIOR]', () => {
  it('pickKillTarget() 输入空数组时抛错', () => {
    expect(() => injA.pickKillTarget([])).toThrow(/no.*container|empty|no target/i);
  });

  it('pickKillTarget() 拒绝 brain/postgres/cecelia-brain 等基础设施容器（白名单 only）', () => {
    const containers = [
      { id: 'c1', name: 'cecelia-brain', labels: { 'cecelia.task_id': 'irrelevant' } },
      { id: 'c2', name: 'postgres', labels: {} },
      { id: 'c3', name: 'sub-task-runner-x', labels: { 'cecelia.task_id': 't-acc-1', 'cecelia.node_name': 'run_sub_task' } },
    ];
    const target = injA.pickKillTarget(containers);
    expect(target.id).toBe('c3');
  });

  it('recordInjectionEvent() 写入 payload schema 严格匹配 spec', async () => {
    const captured: any[] = [];
    const fakePsql = async (sql: string, params: any[]) => {
      captured.push({ sql, params });
      return { rowCount: 1 };
    };
    await injA.recordInjectionEvent({
      taskId: 't-acc-1',
      containerId: 'c3',
      nodeName: 'run_sub_task',
      psql: fakePsql,
    });
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const last = captured[captured.length - 1];
    expect(last.sql).toMatch(/INSERT\s+INTO\s+task_events/i);
    // payload JSON 应同时含三字段
    const blob = JSON.stringify(last.params);
    expect(blob).toContain('docker_sigkill');
    expect(blob).toContain('c3');
    expect(blob).toContain('run_sub_task');
  });

  it('pollHealing() 在 retry_count > 3 时返回 {ok:false, reason:"retry_exhausted"}', async () => {
    const fakeQuery = vi.fn(async () => ({
      retry_count: 4,
      final_status: null,
    }));
    const r = await injA.pollHealing({
      taskId: 't-acc-1',
      sinceEpoch: 1700000000,
      maxRetries: 3,
      query: fakeQuery,
      maxWaitMs: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('retry_exhausted');
  });
});
