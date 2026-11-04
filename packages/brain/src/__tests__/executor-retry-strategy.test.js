/** 调用真实 requeueTask；只隔离数据库、文件和外部执行边界。 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));
vi.mock('child_process', () => ({
  spawn: vi.fn(() => { throw new Error('external spawn forbidden'); }),
  exec: vi.fn(() => { throw new Error('external exec forbidden'); }),
  execSync: vi.fn(() => ''),
  execFile: vi.fn((...args) => { const cb = args.at(-1); if (typeof cb === 'function') cb(null, '', ''); }),
}));
vi.mock('fs', async (original) => {
  const actual = await original();
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const root = resolve(process.cwd(), '../..');
  return { ...actual,
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || target.includes('credential')) {
        throw new Error('non-repository filesystem read forbidden');
      }
      return actual.readFileSync(file, ...args);
    }),
    existsSync: vi.fn(() => false), readdirSync: vi.fn(() => []), unlinkSync: vi.fn(),
  };
});
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));
let requeueTask, classifyFailure;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external network forbidden'); }));
  ({ requeueTask } = await import('../executor.js'));
  ({ classifyFailure } = await import('../quarantine.js'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { query.mockReset(); });

function task(payload) {
  query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT payload, task_type')) return { rows: [{ payload, task_type: 'dev', title: 'isolated retry', started_at: new Date() }] };
    if (sql.startsWith('SELECT id FROM learnings')) return { rows: [{ id: 'already-recorded' }] };
    return { rows: [], rowCount: 1 };
  });
}
function writtenRetry() {
  const call = query.mock.calls.find(([sql]) => sql.includes("SET status = 'queued'"));
  expect(call, '真实 requeueTask 必须写入任务状态').toBeDefined();
  expect(call[0]).toContain("AND status = 'in_progress'");
  return JSON.parse(call[1][1]);
}

describe('真实 Executor retry strategy', () => {
  it.each([
    ['billing_cap', 3600], ['rate_limit', 900], ['network', 30],
  ])('%s 使用分类指定时间而不是默认退避', async (classification, seconds) => {
    const next = new Date(Date.now() + seconds * 1000).toISOString();
    task({ failure_classification: { class: classification, retry_strategy: { should_retry: true, next_run_at: next } } });
    const result = await requeueTask('fixture-task', 'watchdog');
    expect(result.requeued).toBe(true);
    expect(result.next_run_at).toBe(next);
    expect(writtenRetry()).toMatchObject({ next_run_at: next, watchdog_retry_count: 1, failure_count: 1 });
  });
  it('缺少分类时使用本次递增后的重试计数退避', async () => {
    task({ watchdog_retry_count: 0 });
    const before = Date.now();
    const result = await requeueTask('fixture-task', 'watchdog');
    const delay = new Date(result.next_run_at).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(120000);
    expect(delay).toBeLessThan(121000);
    expect(writtenRetry().next_run_at).toBe(result.next_run_at);
  });
  it('AUTH 分类真实返回不重试和人审标志', () => {
    // 旧测试只读自己插入的 JSON；此处验证分类函数本身。watchdog 覆盖策略不属于此断言。
    expect(classifyFailure('Failed to authenticate. OAuth token has expired.')).toMatchObject({
      class: 'auth', retry_strategy: { should_retry: false, needs_human_review: true },
    });
  });
  it('完成任务不能复活或写入 queued', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await requeueTask('completed-task', 'watchdog')).toEqual({ requeued: false, reason: 'not_in_progress' });
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE tasks'))).toBe(false);
  });
});
