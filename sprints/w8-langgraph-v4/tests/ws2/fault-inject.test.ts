import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  findContainerForTask,
  pollLlmRetryEvents,
  pollHarnessInterruptPending,
  injectInitiativeDeadlineOverdue,
  assertWatchdogMarkedFailed,
  recordInjectionTimestamp,
  replayInjectionEvidence,
  snapshotWorkspaceMount,
  diffWorkspaceMounts,
  checkCredentialInvalidEvent,
  recordSkippedInjection,
} from '../../../../scripts/acceptance/w8-v4/fault-inject.mjs';

describe('Workstream 2 — fault injection helpers [BEHAVIOR]', () => {
  it('findContainerForTask 多容器时取第一个', async () => {
    const docker = vi.fn().mockResolvedValue({ stdout: 'container-aaa\ncontainer-bbb\n' });
    const name = await findContainerForTask({ docker, taskId: 'tid' });
    expect(name).toBe('container-aaa');
  });

  it('findContainerForTask 无容器时抛错且错误含 taskId', async () => {
    const docker = vi.fn().mockResolvedValue({ stdout: '' });
    await expect(findContainerForTask({ docker, taskId: 'tid-xyz' })).rejects.toThrow(/tid-xyz/);
  });

  it('pollLlmRetryEvents 超过 capMax=3 时抛错（不静默）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '5' }] });
    await expect(pollLlmRetryEvents({
      query,
      taskId: 'tid',
      sinceTs: 0,
      capMax: 3,
      timeoutMin: 1,
    })).rejects.toThrow(/cap|exceed|5/);
  });

  it('pollLlmRetryEvents 1-3 之间正常返回数', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '2' }] });
    const n = await pollLlmRetryEvents({
      query,
      taskId: 'tid',
      sinceTs: 0,
      capMax: 3,
      timeoutMin: 1,
    });
    expect(n).toBe(2);
  });

  it('pollHarnessInterruptPending 超时未见 pending 时抛错且错误含 task_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(pollHarnessInterruptPending({
      query,
      taskId: 'tid-zzz',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow(/tid-zzz/);
  });

  it('pollHarnessInterruptPending 命中时返回 row id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'intr-001' }] });
    const id = await pollHarnessInterruptPending({
      query,
      taskId: 'tid',
      sinceTs: 0,
      timeoutMin: 1,
    });
    expect(id).toBe('intr-001');
  });

  it('(R8) injectInitiativeDeadlineOverdue 仅改 phase=running 行，0 行时返回 0 不抛错（lenient 默认）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const n = await injectInitiativeDeadlineOverdue({
      query,
      initiativeId: 'harness-acceptance-v4-2026-05-08',
    });
    expect(n).toBe(0);
    expect(query.mock.calls[0][0]).toMatch(/phase\s*=\s*['"]running['"]/);
  });

  it('injectInitiativeDeadlineOverdue 改了 ≥1 行时返回数', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'r1' }] });
    const n = await injectInitiativeDeadlineOverdue({
      query,
      initiativeId: 'harness-acceptance-v4-2026-05-08',
    });
    expect(n).toBe(1);
  });

  it('assertWatchdogMarkedFailed 必须 phase=failed AND failure_reason=watchdog_overdue', async () => {
    const queryFailedNoReason = vi.fn().mockResolvedValue({ rows: [{ phase: 'failed', failure_reason: 'natural_error' }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryFailedNoReason,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow(/watchdog_overdue/);

    const queryRunning = vi.fn().mockResolvedValue({ rows: [{ phase: 'running', failure_reason: null }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryRunning,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow();

    const queryGood = vi.fn().mockResolvedValue({ rows: [{ phase: 'failed', failure_reason: 'watchdog_overdue' }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryGood,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 1,
    })).resolves.toBeDefined();
  });

  // R4 cascade mitigation: 独立 INJECT_TS 文件落盘 + 回放
  it('recordInjectionTimestamp 写 JSON 到 ${dir}/inject-${kind}.json 含 kind/taskId/injectTs/target/meta', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r4-'));
    await recordInjectionTimestamp({
      kind: 'A',
      dir,
      taskId: 'task-1',
      injectTs: 1715140800,
      target: 'container-xxx',
      meta: { node_hint: 'run_sub_task' },
    });
    const raw = await fs.readFile(path.join(dir, 'inject-a.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe('A');
    expect(parsed.taskId).toBe('task-1');
    expect(parsed.injectTs).toBe(1715140800);
    expect(parsed.target).toBe('container-xxx');
    expect(parsed.meta.node_hint).toBe('run_sub_task');
    await fs.rm(dir, { recursive: true });
  });

  it('recordInjectionTimestamp 不存在的 dir 自动 mkdir -p', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r4-'));
    const dir = path.join(root, 'nested/sub');
    await recordInjectionTimestamp({
      kind: 'B',
      dir,
      taskId: 't',
      injectTs: 1,
      target: 'x',
      meta: {},
    });
    const exists = await fs.stat(path.join(dir, 'inject-b.json')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    await fs.rm(root, { recursive: true });
  });

  it('replayInjectionEvidence 读取 inject-{a,b,c}.json 三件齐全返回数组', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r4-'));
    for (const kind of ['A', 'B', 'C']) {
      await fs.writeFile(
        path.join(dir, `inject-${kind.toLowerCase()}.json`),
        JSON.stringify({ kind, taskId: 't', injectTs: 1, target: 'x', meta: {} }),
        'utf8',
      );
    }
    const replay = await replayInjectionEvidence({ dir });
    expect(replay).toHaveLength(3);
    expect(replay.map((r) => r.kind).sort()).toEqual(['A', 'B', 'C']);
    await fs.rm(dir, { recursive: true });
  });

  it('replayInjectionEvidence 缺文件时抛错并指出哪个 kind 缺', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r4-'));
    await fs.writeFile(
      path.join(dir, 'inject-a.json'),
      JSON.stringify({ kind: 'A', taskId: 't', injectTs: 1, target: 'x', meta: {} }),
      'utf8',
    );
    await expect(replayInjectionEvidence({ dir })).rejects.toThrow(/B|C|missing/);
    await fs.rm(dir, { recursive: true });
  });

  // R8 mitigation: replayInjectionEvidence 接受 inject-c-skipped.json fallback
  it('(R8) replayInjectionEvidence 接受 inject-c-skipped.json 替代 inject-c.json 返回 status=skipped', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r8-'));
    await fs.writeFile(path.join(dir, 'inject-a.json'),
      JSON.stringify({ kind: 'A', taskId: 't', injectTs: 1, target: 'x', meta: {} }), 'utf8');
    await fs.writeFile(path.join(dir, 'inject-b.json'),
      JSON.stringify({ kind: 'B', taskId: 't', injectTs: 2, target: 'y', meta: {} }), 'utf8');
    await fs.writeFile(path.join(dir, 'inject-c-skipped.json'),
      JSON.stringify({ kind: 'C', taskId: 't', injectTs: 3, reason: 'no_running_initiative_run', meta: {} }), 'utf8');
    const replay = await replayInjectionEvidence({ dir });
    expect(replay).toHaveLength(3);
    const kindC = replay.find((r) => r.kind === 'C');
    expect(kindC.status).toBe('skipped');
    await fs.rm(dir, { recursive: true });
  });

  // R6 mitigation: workspace mount snapshot
  it('(R6) snapshotWorkspaceMount 落盘 mount-${label}.txt 含 exec stdout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r6-'));
    const exec = vi.fn().mockReturnValue('total 4\ndrwxr-xr-x 1 root root 0 May 8 09:00 .\ndrwxr-xr-x 1 root root 0 May 8 09:00 ..\n');
    await snapshotWorkspaceMount({ exec, label: 'step2', dir });
    const out = await fs.readFile(path.join(dir, 'mount-step2.txt'), 'utf8');
    expect(out).toContain('total 4');
    expect(exec).toHaveBeenCalledWith(expect.stringMatching(/docker exec brain ls.*\/workspace/));
    await fs.rm(dir, { recursive: true });
  });

  it('(R6) snapshotWorkspaceMount 不存在的 dir 自动 mkdir -p', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r6-'));
    const dir = path.join(root, 'nested/sub');
    const exec = vi.fn().mockReturnValue('drwxr-xr-x\n');
    await snapshotWorkspaceMount({ exec, label: 'step4', dir });
    const exists = await fs.stat(path.join(dir, 'mount-step4.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    await fs.rm(root, { recursive: true });
  });

  it('(R6) diffWorkspaceMounts 输出 added/removed 数组写到 outPath', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r6-'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    const out = path.join(dir, 'diff.txt');
    await fs.writeFile(a, 'line1\nline2\nline3\n', 'utf8');
    await fs.writeFile(b, 'line1\nline2-changed\nline3\nline4\n', 'utf8');
    const result = await diffWorkspaceMounts({ snapAPath: a, snapBPath: b, outPath: out });
    expect(result.added).toContain('line2-changed');
    expect(result.added).toContain('line4');
    expect(result.removed).toContain('line2');
    const diffContent = await fs.readFile(out, 'utf8');
    expect(diffContent.length).toBeGreaterThan(0);
    await fs.rm(dir, { recursive: true });
  });

  // R7 mitigation: credential_invalid event check
  it('(R7) checkCredentialInvalidEvent 0 rows 返回 0 不抛错', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '0' }] });
    const n = await checkCredentialInvalidEvent({ query, taskId: 'tid', sinceTs: 0 });
    expect(n).toBe(0);
  });

  it('(R7) checkCredentialInvalidEvent ≥1 rows 抛错信息含 credential_invalid: aborting acceptance', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '2' }] });
    await expect(checkCredentialInvalidEvent({
      query, taskId: 'tid', sinceTs: 0,
    })).rejects.toThrow(/credential_invalid: aborting acceptance/);
  });

  // R8 mitigation: recordSkippedInjection 写 inject-${kind}-skipped.json
  it('(R8) recordSkippedInjection 写 ${dir}/inject-${kind}-skipped.json 含 reason 字段', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r8-'));
    await recordSkippedInjection({
      kind: 'C',
      dir,
      taskId: 'tid',
      reason: 'no_running_initiative_run',
      injectTs: 1715140800,
      meta: { cascade_source: 'step5_abort', sql_rows_affected: 0 },
    });
    const raw = await fs.readFile(path.join(dir, 'inject-c-skipped.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe('C');
    expect(parsed.reason).toBe('no_running_initiative_run');
    expect(parsed.meta.cascade_source).toBe('step5_abort');
    expect(parsed.injectTs).toBe(1715140800);
    await fs.rm(dir, { recursive: true });
  });

  it('(R8) recordSkippedInjection 不存在的 dir 自动 mkdir -p', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-r8-'));
    const dir = path.join(root, 'auto/created');
    await recordSkippedInjection({
      kind: 'C',
      dir,
      taskId: 't',
      reason: 'no_running_initiative_run',
      injectTs: 1,
      meta: {},
    });
    const exists = await fs.stat(path.join(dir, 'inject-c-skipped.json')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    await fs.rm(root, { recursive: true });
  });
});
