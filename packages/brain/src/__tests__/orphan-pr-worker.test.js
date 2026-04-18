/**
 * orphan-pr-worker 单元测试 (vitest)
 *
 * Mock 策略：
 *   - mock child_process.execSync  → 控制 gh CLI 输出
 *   - pool.query = vi.fn()          → 控制 Brain 查询结果
 *
 * 覆盖场景：
 *   1. 无 open PR → scanned=0
 *   2. PR 刚创建（< 2h） → skip（不入候选）
 *   3. PR > 2h 但有 Brain in_progress task → 不是孤儿，skip
 *   4. PR > 2h 无 Brain task，CI 全绿 → merge
 *   5. PR > 2h 无 Brain task，CI 有 fail → label
 *   6. PR > 2h 无 Brain task，CI 还在跑 → skip
 *   7. 单 PR 处理挂不阻止其他 PR（错误隔离）
 *   8. dryRun=true 不触发 merge/label CLI
 *   9. ageThresholdHours 可配置
 *
 * 部署落位：orphan-pr-worker.test.js，放到
 *          packages/brain/src/__tests__/orphan-pr-worker.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';

const { scanOrphanPrs } = await import('../orphan-pr-worker.js');

function makePool() {
  return { query: vi.fn() };
}

function hoursAgoIso(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

/**
 * 构造一个 execSync mock 路由表：
 *   - 'gh pr list ...' → 返回 PR 列表 JSON
 *   - 'gh pr checks <n> ...' → 返回对应 PR 的 checks JSON（或抛错 + stdout）
 *   - 'gh pr merge <n> ...' → 记录并返回 ''
 *   - 'gh pr edit <n> --add-label ...' → 记录并返回 ''
 */
function routeExec({ prList = [], prChecks = {}, throwOn = {}, onMerge, onLabel }) {
  return (cmd /* , opts */) => {
    if (cmd.startsWith('gh pr list')) {
      return JSON.stringify(prList);
    }
    const checksMatch = cmd.match(/^gh pr checks (\d+)/);
    if (checksMatch) {
      const num = checksMatch[1];
      if (throwOn[num] === 'checks') {
        const err = new Error('gh pr checks exit 1');
        err.stdout = prChecks[num] ? JSON.stringify(prChecks[num]) : '';
        throw err;
      }
      return JSON.stringify(prChecks[num] || []);
    }
    const mergeMatch = cmd.match(/^gh pr merge (\d+)/);
    if (mergeMatch) {
      if (onMerge) onMerge(Number(mergeMatch[1]), cmd);
      if (throwOn[mergeMatch[1]] === 'merge') {
        throw new Error('merge conflict');
      }
      return '';
    }
    const editMatch = cmd.match(/^gh pr edit (\d+)/);
    if (editMatch) {
      if (onLabel) onLabel(Number(editMatch[1]), cmd);
      return '';
    }
    return '';
  };
}

describe('orphan-pr-worker', () => {
  let pool;

  beforeEach(() => {
    execSync.mockReset();
    pool = makePool();
  });

  it('case 1: 无 open PR → scanned=0', async () => {
    execSync.mockImplementation(routeExec({ prList: [] }));
    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(0);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.details).toEqual([]);
    // DB 不应被查（没有候选）
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('case 2: PR 刚创建（< 2h）→ 不入候选', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 100,
            url: 'https://github.com/o/r/pull/100',
            headRefName: 'cp-04181830-fresh',
            createdAt: hoursAgoIso(1),
            updatedAt: hoursAgoIso(0.5),
          },
        ],
      })
    );
    const r = await scanOrphanPrs(pool);
    // 被 age threshold 过滤掉，scanned=0
    expect(r.scanned).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('case 2b: 非 cp- 分支即使 > 2h 也不入候选', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 101,
            url: 'https://github.com/o/r/pull/101',
            headRefName: 'feature/not-cp',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
      })
    );
    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(0);
  });

  it('case 3: PR > 2h 但有 Brain in_progress task → skip brain_task_active', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 200,
            url: 'https://github.com/o/r/pull/200',
            headRefName: 'cp-04181700-active',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'task-abc' }] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 200,
      action: 'skipped',
      reason: 'brain_task_active',
    });
    // 不应调 gh pr checks / merge / edit
    const cmds = execSync.mock.calls.map((c) => c[0]);
    expect(cmds.some((c) => c.startsWith('gh pr checks'))).toBe(false);
    expect(cmds.some((c) => c.startsWith('gh pr merge'))).toBe(false);
    expect(cmds.some((c) => c.startsWith('gh pr edit'))).toBe(false);
  });

  it('case 4: PR > 2h 无 Brain task，CI 全绿 → merge', async () => {
    const merged = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 300,
            url: 'https://github.com/o/r/pull/300',
            headRefName: 'cp-04181500-green',
            createdAt: hoursAgoIso(6),
            updatedAt: hoursAgoIso(3),
          },
        ],
        prChecks: {
          300: [
            { name: 'ci-l1', state: 'SUCCESS', conclusion: 'SUCCESS' },
            { name: 'ci-l2', state: 'SUCCESS', conclusion: 'SUCCESS' },
            { name: 'skipped-job', state: 'COMPLETED', conclusion: 'SKIPPED' },
          ],
        },
        onMerge: (n, cmd) => merged.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [] }); // no brain task

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.merged).toBe(1);
    expect(r.labeled).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 300,
      action: 'merged',
      reason: 'ci_green',
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].n).toBe(300);
    expect(merged[0].cmd).toContain('--squash');
    expect(merged[0].cmd).toContain('--delete-branch');
  });

  it('case 5: PR > 2h 无 Brain task，CI 有 fail → label needs-attention', async () => {
    const labeled = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 400,
            url: 'https://github.com/o/r/pull/400',
            headRefName: 'cp-04181400-red',
            createdAt: hoursAgoIso(4),
            updatedAt: hoursAgoIso(2),
          },
        ],
        prChecks: {
          400: [
            { name: 'ci-l1', state: 'SUCCESS', conclusion: 'SUCCESS' },
            { name: 'ci-l3', state: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        },
        throwOn: { 400: 'checks' }, // gh pr checks 在有 fail 时 exit 非零
        onLabel: (n, cmd) => labeled.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.labeled).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 400,
      action: 'labeled',
      reason: 'ci_failure',
    });
    expect(labeled).toHaveLength(1);
    expect(labeled[0].n).toBe(400);
    expect(labeled[0].cmd).toContain('--add-label');
    expect(labeled[0].cmd).toContain('needs-attention');
  });

  it('case 6: PR > 2h 无 Brain task，CI 还在跑 → skip ci_pending', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 500,
            url: 'https://github.com/o/r/pull/500',
            headRefName: 'cp-04181200-pending',
            createdAt: hoursAgoIso(3),
            updatedAt: hoursAgoIso(1),
          },
        ],
        prChecks: {
          500: [
            { name: 'ci-l1', state: 'SUCCESS', conclusion: 'SUCCESS' },
            { name: 'ci-l3', state: 'IN_PROGRESS', conclusion: '' },
          ],
        },
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 500,
      action: 'skipped',
      reason: 'ci_pending',
    });
    const cmds = execSync.mock.calls.map((c) => c[0]);
    expect(cmds.some((c) => c.startsWith('gh pr merge'))).toBe(false);
    expect(cmds.some((c) => c.startsWith('gh pr edit'))).toBe(false);
  });

  it('case 7: 单 PR merge 挂不阻止其他 PR', async () => {
    const merged = [];
    const labeled = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 601,
            url: 'https://github.com/o/r/pull/601',
            headRefName: 'cp-04180900-a',
            createdAt: hoursAgoIso(10),
            updatedAt: hoursAgoIso(8),
          },
          {
            number: 602,
            url: 'https://github.com/o/r/pull/602',
            headRefName: 'cp-04180900-b',
            createdAt: hoursAgoIso(10),
            updatedAt: hoursAgoIso(8),
          },
          {
            number: 603,
            url: 'https://github.com/o/r/pull/603',
            headRefName: 'cp-04180900-c',
            createdAt: hoursAgoIso(10),
            updatedAt: hoursAgoIso(8),
          },
        ],
        prChecks: {
          601: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
          602: [
            { name: 'ci', state: 'COMPLETED', conclusion: 'FAILURE' },
          ],
          603: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        },
        throwOn: { 601: 'merge', 602: 'checks' }, // 601 merge 抛错，602 checks 非零仍有 stdout
        onMerge: (n, cmd) => merged.push({ n, cmd }),
        onLabel: (n, cmd) => labeled.push({ n, cmd }),
      })
    );
    // 三次 DB 查询都返回无 task
    pool.query.mockResolvedValue({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(3);
    // 601 merge 挂 → error 记入 skipped 计数
    // 602 fail → labeled
    // 603 success → merged
    expect(r.merged).toBe(1);
    expect(r.labeled).toBe(1);
    expect(r.skipped).toBe(1);
    expect(merged.map((m) => m.n)).toContain(603);
    expect(labeled.map((l) => l.n)).toContain(602);
    const errDetail = r.details.find((d) => d.action === 'error');
    expect(errDetail).toBeTruthy();
    expect(errDetail.pr).toBe(601);
  });

  it('case 8: dryRun=true 不触发 merge/label CLI', async () => {
    const merged = [];
    const labeled = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 700,
            url: 'https://github.com/o/r/pull/700',
            headRefName: 'cp-04180800-dry',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(3),
          },
        ],
        prChecks: {
          700: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        },
        onMerge: (n, cmd) => merged.push({ n, cmd }),
        onLabel: (n, cmd) => labeled.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [] });

    const r = await scanOrphanPrs(pool, { dryRun: true });
    expect(r.merged).toBe(1);
    // dry-run 不调 gh pr merge
    expect(merged).toHaveLength(0);
    expect(labeled).toHaveLength(0);
  });

  it('case 9: ageThresholdHours 可配置', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 800,
            url: 'https://github.com/o/r/pull/800',
            headRefName: 'cp-04180700-edge',
            createdAt: hoursAgoIso(1.5), // 1.5h 前：默认 2h 不入候选
            updatedAt: hoursAgoIso(1),
          },
        ],
        prChecks: {
          800: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        },
      })
    );
    pool.query.mockResolvedValue({ rows: [] });

    // 默认 2h → 不入候选
    const r1 = await scanOrphanPrs(pool);
    expect(r1.scanned).toBe(0);

    // 阈值 1h → 入候选并被 merge
    const r2 = await scanOrphanPrs(pool, { ageThresholdHours: 1 });
    expect(r2.scanned).toBe(1);
    expect(r2.merged).toBe(1);
  });

  it('case 10: gh pr list 抛错 → 非致命，返回 zero summary', async () => {
    execSync.mockImplementation(() => {
      throw new Error('gh not authenticated');
    });
    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(0);
    expect(r.merged).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('case 11: Brain query 失败 → 保守跳过该 PR（当作非孤儿）', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 900,
            url: 'https://github.com/o/r/pull/900',
            headRefName: 'cp-04180600-dberr',
            createdAt: hoursAgoIso(4),
            updatedAt: hoursAgoIso(3),
          },
        ],
        prChecks: {
          900: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        },
      })
    );
    pool.query.mockRejectedValueOnce(new Error('db down'));

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 900,
      action: 'skipped',
      reason: 'brain_task_active', // 保守当作 "有 task 在管"
    });
  });

  it('case 12: self-label 可通过 opts.label 覆盖默认', async () => {
    const labeled = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 1000,
            url: 'https://github.com/o/r/pull/1000',
            headRefName: 'cp-04180500-custom',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
        prChecks: {
          1000: [{ name: 'ci', state: 'COMPLETED', conclusion: 'FAILURE' }],
        },
        throwOn: { 1000: 'checks' },
        onLabel: (n, cmd) => labeled.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [] });

    await scanOrphanPrs(pool, { label: 'orphan-auto-triage' });
    expect(labeled[0].cmd).toContain('orphan-auto-triage');
    expect(labeled[0].cmd).not.toContain('needs-attention');
  });
});
