import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ZJ owns the retired executeQueuedContentTasks cleanup. This file protects the
// still-active startup-sync contract by calling the actual executor entry point.
const boundary = vi.hoisted(() => {
  const unexpected: string[] = [];
  return {
    query: vi.fn(),
    aliveTaskIds: new Set<string>(),
    unexpected,
    blocked: vi.fn((operation: string) => {
      unexpected.push(operation);
      throw new Error(`External operation forbidden: ${operation}`);
    }),
  };
});
vi.mock('../db.js', () => ({
  default: { query: boundary.query, connect: () => boundary.blocked('DB connect') },
  getPoolHealth: () => ({ waiting: 0, idle: 1, total: 1, activeCount: 0 }),
}));
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  const operations = {
    execSync: vi.fn((command: string) => {
      const match = command.match(/^ps aux \| grep -F "([a-zA-Z0-9_-]+)" \| grep -v grep \| wc -l$/);
      if (match) return boundary.aliveTaskIds.has(match[1]) ? '1\n' : '0\n';
      return boundary.blocked(`execSync:${command}`);
    }),
    execFileSync: () => boundary.blocked('execFileSync'),
    exec: () => boundary.blocked('exec'),
    spawn: () => boundary.blocked('spawn'),
  };
  return { ...actual, ...operations, default: { ...actual, ...operations } };
});
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const filename = (file: unknown) => file instanceof URL ? fileURLToPath(file) : String(file);
  const operations = {
    readFileSync: (file: unknown, ...args: unknown[]) => {
      if (!filename(file).startsWith(root)) return boundary.blocked(`read:${filename(file)}`);
      return Reflect.apply(actual.readFileSync, actual, [file, ...args]);
    },
    existsSync: (file: unknown) => filename(file).startsWith(root) && actual.existsSync(filename(file)),
    readdirSync: (file: unknown, ...args: unknown[]) => filename(file).startsWith(root)
      ? Reflect.apply(actual.readdirSync, actual, [file, ...args]) : [],
    writeFileSync: () => boundary.blocked('writeFileSync'),
    mkdirSync: () => boundary.blocked('mkdirSync'),
    unlinkSync: () => boundary.blocked('unlinkSync'),
    rmSync: () => boundary.blocked('rmSync'),
  };
  return { ...actual, ...operations, default: { ...actual, ...operations } };
});
vi.mock('fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: () => boundary.blocked('writeFile'), mkdir: () => boundary.blocked('mkdir') };
});

interface StartupTask {
  id: string;
  title: string;
  task_type: string;
  executor_kind: string;
  claimed_by: null;
  payload: Record<string, unknown> | null;
  started_at: string;
  error_message: string | null;
}
function inlineTask(payload: StartupTask['payload']): StartupTask {
  return { id: 'inline-pipeline', title: '重启时的内联编排标记', task_type: 'content-pipeline',
    executor_kind: 'external-worker', claimed_by: null, payload,
    started_at: '2026-11-01T00:00:00Z', error_message: 'obsolete transient error' };
}
let executor: typeof import('../executor.js');
let signal: ReturnType<typeof vi.spyOn>;
let network: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  signal = vi.spyOn(process, 'kill').mockImplementation(() => boundary.blocked('process.kill'));
  network = vi.fn(() => boundary.blocked('fetch'));
  vi.stubGlobal('fetch', network);
  try {
    executor = await import('../executor.js');
    expect(boundary.unexpected).toEqual([]);
    expect(signal).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
beforeEach(() => {
  boundary.query.mockReset();
  boundary.aliveTaskIds.clear();
  boundary.unexpected.length = 0;
  vi.stubEnv('BRAIN_DEPLOY_CANARY', '0');
  signal = vi.spyOn(process, 'kill').mockImplementation(() => boundary.blocked('process.kill'));
  network = vi.fn(() => boundary.blocked('fetch'));
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  try {
    expect(boundary.unexpected).toEqual([]);
    expect(signal).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    executor.removeActiveProcess('inline-pipeline');
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
});

function selectTasks(rows: StartupTask[]) {
  boundary.query.mockImplementation(async (sql: string) => {
    if (/SELECT id, title, payload/.test(sql)) return { rows, rowCount: rows.length };
    if (/UPDATE tasks/.test(sql)) return { rows: [], rowCount: 1 };
    return boundary.blocked(`Unexpected SQL: ${sql}`);
  });
}

describe('真实 syncOrphanTasksOnStartup：content-pipeline 无 runId 标记', () => {
  it.each([
    { pipeline_keyword: 'fixture', content_type: 'solo-company-case', watchdog_retry_count: 7 },
    { pipeline_keyword: 'fixture', current_run_id: null, watchdog_retry_count: 2 },
    null,
  ])('没有活进程时重排队、清错误、重置重试；payload=%j', async payload => {
    selectTasks([inlineTask(payload)]);
    expect(await executor.syncOrphanTasksOnStartup()).toEqual({ orphans_found: 1, orphans_fixed: 0, requeued: 1, rebuilt: 0, external_skipped: 0 });
    expect(boundary.query).toHaveBeenCalledTimes(2);
    const [sql, params] = boundary.query.mock.calls[1];
    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('error_message = NULL');
    expect(sql).toContain("payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb");
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual(['inline-pipeline', '{"watchdog_retry_count":0}']);
  });

  it('存在匹配活进程时重建执行登记，不回队、不标失败；重复同步仍不回队', async () => {
    selectTasks([inlineTask({ pipeline_keyword: 'alive' })]);
    boundary.aliveTaskIds.add('inline-pipeline');
    expect(await executor.syncOrphanTasksOnStartup()).toEqual({ orphans_found: 0, orphans_fixed: 0, requeued: 0, rebuilt: 1, external_skipped: 0 });
    expect(boundary.query).toHaveBeenCalledOnce();
    boundary.query.mockClear();
    expect((await executor.syncOrphanTasksOnStartup()).rebuilt).toBe(1);
    expect(boundary.query).toHaveBeenCalledOnce();
  });

  it('没有 in_progress 任务时只读取，不凭空写入恢复记录', async () => {
    selectTasks([]);
    expect(await executor.syncOrphanTasksOnStartup()).toEqual({ orphans_found: 0, orphans_fixed: 0, requeued: 0, rebuilt: 0, external_skipped: 0 });
    expect(boundary.query).toHaveBeenCalledOnce();
  });

  it('读取任务失败时传播原始数据库错误，不伪报恢复成功', async () => {
    boundary.query.mockRejectedValueOnce(new Error('fixture DB read failed'));
    await expect(executor.syncOrphanTasksOnStartup()).rejects.toThrow('fixture DB read failed');
    expect(boundary.query).toHaveBeenCalledOnce();
  });
});
