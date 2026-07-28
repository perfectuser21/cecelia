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
import { findDuplicateSibling } from '../dispatch-dedup.js';

const { scanOrphanPrs, _internals } = await import('../orphan-pr-worker.js');

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

  it('case 3b: arbitrary-title PR owned by initiative_runs is protected from orphan merge', async () => {
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 201,
            url: 'https://github.com/o/r/pull/201',
            headRefName: 'cp-07280905-kernel-result',
            title: 'fix(ci): mutable title must not grant merge authority',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
        prChecks: {
          201: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        },
      })
    );
    pool.query.mockResolvedValueOnce({ rows: [{ owner_kind: 'initiative_run' }] });

    const r = await scanOrphanPrs(pool);

    expect(r).toMatchObject({ scanned: 1, merged: 0, skipped: 1 });
    expect(r.details[0]).toMatchObject({
      pr: 201,
      action: 'skipped',
      reason: 'brain_task_active',
    });
    expect(pool.query.mock.calls[0][0]).toContain('initiative_runs');
    expect(execSync.mock.calls.map((call) => call[0]).some((cmd) => cmd.startsWith('gh pr merge'))).toBe(false);
  });

  it('case 4: PR > 2h 无 Brain task，CI 全绿 → no merge without authorization receipt', async () => {
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
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.details[0]).toMatchObject({
      pr: 300,
      action: 'skipped',
      reason: 'ci_green_requires_merge_authorization',
    });
    expect(merged).toHaveLength(0);
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

  it('case 7: multiple green orphans never reach merge while red orphan is still labeled', async () => {
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
        throwOn: { 602: 'checks' },
        onMerge: (n, cmd) => merged.push({ n, cmd }),
        onLabel: (n, cmd) => labeled.push({ n, cmd }),
      })
    );
    // 三次 DB 查询都返回无 task
    pool.query.mockResolvedValue({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(3);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(1);
    expect(r.skipped).toBe(2);
    expect(merged).toHaveLength(0);
    expect(labeled.map((l) => l.n)).toContain(602);
    expect(r.details.filter((d) => d.reason === 'ci_green_requires_merge_authorization')).toHaveLength(2);
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
    expect(r.merged).toBe(0);
    expect(r.skipped).toBe(1);
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

    // 阈值 1h → 入候选，但仍不能绕过 merge authorization
    const r2 = await scanOrphanPrs(pool, { ageThresholdHours: 1 });
    expect(r2.scanned).toBe(1);
    expect(r2.merged).toBe(0);
    expect(r2.skipped).toBe(1);
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

  it('case 13: harness sub_task PR（cp-*-ws-<hex>）→ skip harness_subtask_pr，不合不 label', async () => {
    const merged = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 1300,
            url: 'https://github.com/o/r/pull/1300',
            headRefName: 'cp-06181506-ws-3f893d17-ws1',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
        prChecks: { 1300: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }] },
        onMerge: (n, cmd) => merged.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValue({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.details[0]).toMatchObject({ pr: 1300, action: 'skipped', reason: 'harness_subtask_pr' });
    expect(merged).toHaveLength(0);
    // 不应查 Brain DB（豁免在 DB 查询之前）
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('orphan-pr-worker 红孤儿超期关闭', () => {
  it('classifyChecks=failure 且超过 staleCloseDays 且无 keep label → 应关闭', () => {
    const pr = {
      number: 101,
      labels: [],
      ageHours: 24 * 8, // 8 天，超过默认 7 天阈值
    };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(true);
  });

  it('未超过阈值 → 不关闭', () => {
    const pr = { number: 102, labels: [], ageHours: 24 * 3 };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(false);
  });

  it('带 keep label → 即使超期也不关闭', () => {
    const pr = { number: 103, labels: [{ name: 'keep' }], ageHours: 24 * 30 };
    expect(_internals.shouldCloseStaleFail(pr, 7)).toBe(false);
  });

  it('hasKeepLabel 正确识别有/无 keep 标签', () => {
    expect(_internals.hasKeepLabel({ labels: [{ name: 'keep' }] })).toBe(true);
    expect(_internals.hasKeepLabel({ labels: [{ name: 'needs-attention' }] })).toBe(false);
    expect(_internals.hasKeepLabel({ labels: [] })).toBe(false);
    expect(_internals.hasKeepLabel({})).toBe(false);
  });
});

describe('orphan-pr-worker scanOrphanPrs → result.closed 汇总计数', () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  it('CI failure 超期红孤儿 → result.closed=1，不影响 merged/labeled', async () => {
    const closedCmds = [];
    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr list')) {
        return JSON.stringify([
          {
            number: 900,
            url: 'https://github.com/o/r/pull/900',
            headRefName: 'cp-06010000-stale-red',
            createdAt: hoursAgoIso(24 * 10), // 10 天前，超过默认 7 天阈值
            updatedAt: hoursAgoIso(24 * 9),
            labels: [],
          },
        ]);
      }
      if (/^gh pr checks 900/.test(cmd)) {
        const err = new Error('gh pr checks exit 1');
        err.stdout = JSON.stringify([
          { name: 'ci', state: 'COMPLETED', conclusion: 'FAILURE' },
        ]);
        throw err;
      }
      if (/^gh pr comment 900/.test(cmd) || /^gh pr close 900/.test(cmd)) {
        closedCmds.push(cmd);
        return '';
      }
      return '';
    });

    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const r = await scanOrphanPrs(pool);

    expect(r.scanned).toBe(1);
    expect(r.closed).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 900,
      action: 'closed',
      reason: 'ci_failure_stale',
    });
    // 关闭走 comment + close，不删分支
    expect(closedCmds.some((c) => c.startsWith('gh pr comment 900'))).toBe(true);
    expect(closedCmds.some((c) => c.startsWith('gh pr close 900'))).toBe(true);
    expect(closedCmds.some((c) => c.includes('--delete-branch'))).toBe(false);
  });

  it('result 初始化对象包含 closed 字段（无候选 PR 场景）', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr list')) return JSON.stringify([]);
      return '';
    });
    const pool = makePool();
    const r = await scanOrphanPrs(pool);
    expect(r).toHaveProperty('closed');
    expect(r.closed).toBe(0);
  });
});

describe('orphan-pr-worker superseded 检测', () => {
  it('findDuplicateSibling 能在真实案例数据下识别 superseded 关系（用实现里的 SUPERSEDED_TITLE_THRESHOLD 校准）', () => {
    const candidateTitle = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收';
    const mergedPrs = [
      { number: 3650, title: 'feat: skill-eval-worker 超时回收 + pm2 常驻脚本 + 并发冒烟', state: 'MERGED' },
      { number: 999, title: '完全无关的 PR 标题内容', state: 'MERGED' },
    ];
    const hit = findDuplicateSibling(candidateTitle, mergedPrs, {
      threshold: _internals.SUPERSEDED_TITLE_THRESHOLD,
      keyFn: (p) => p.title || '',
    });
    expect(hit).not.toBeNull();
    expect(hit.number).toBe(3650);
  });

  it('superseded 场景下 keep label 依然生效（不关闭）', () => {
    expect(_internals.hasKeepLabel({ labels: [{ name: 'keep' }] })).toBe(true);
  });

  const supersedeCandidateTitle = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收';
  const mergedSiblingTitle = 'feat: skill-eval-worker 超时回收 + pm2 常驻脚本 + 并发冒烟';

  function mockGhForSupersededScenario() {
    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr list --author @me --state open')) {
        return JSON.stringify([
          {
            number: 2000,
            url: 'https://github.com/o/r/pull/2000',
            headRefName: 'cp-07130000-supersede-candidate',
            createdAt: hoursAgoIso(3), // 3h，超过默认 2h age 阈值，成为候选
            updatedAt: hoursAgoIso(3),
            labels: [],
            title: supersedeCandidateTitle,
          },
        ]);
      }
      if (cmd.startsWith('gh pr list --author @me --state merged')) {
        return JSON.stringify([
          {
            number: 3650,
            url: 'https://github.com/o/r/pull/3650',
            headRefName: 'cp-07120000-merged-sibling',
            title: mergedSiblingTitle,
          },
        ]);
      }
      if (/^gh pr comment 2000/.test(cmd) || /^gh pr close 2000/.test(cmd)) {
        return '';
      }
      if (/^gh pr checks 2000/.test(cmd)) {
        // 不应该走到这一步（active=true 场景应在 hasActiveBrainTask 处就 skip，
        // active=false 场景应在 superseded 分支就 close+continue，两者都不该调用 classifyChecks）
        return JSON.stringify([{ name: 'ci', state: 'COMPLETED', conclusion: 'SUCCESS' }]);
      }
      return '';
    });
  }

  it('顺序保护：hasActiveBrainTask=true（Brain 有任务在管）时，即使标题命中 superseded 也不关闭，走 brain_task_active skip', async () => {
    mockGhForSupersededScenario();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-1' }] }) }; // 有活跃任务

    const r = await scanOrphanPrs(pool);

    expect(r.closed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.details[0]).toMatchObject({
      pr: 2000,
      action: 'skipped',
      reason: 'brain_task_active',
    });
    // classifyChecks（gh pr checks）不应被调用，也不应调用 close
    const calledCmds = execSync.mock.calls.map((c) => c[0]);
    expect(calledCmds.some((c) => c.startsWith('gh pr checks 2000'))).toBe(false);
    expect(calledCmds.some((c) => c.startsWith('gh pr close 2000'))).toBe(false);
  });

  it('对照：hasActiveBrainTask=false（真孤儿）+ 标题命中 superseded → 应被 closePr，result.closed 递增', async () => {
    mockGhForSupersededScenario();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }; // 无活跃任务，真孤儿

    const r = await scanOrphanPrs(pool);

    expect(r.closed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.details[0]).toMatchObject({
      pr: 2000,
      action: 'closed',
      reason: 'superseded',
      superseded_by: 3650,
    });
    const calledCmds = execSync.mock.calls.map((c) => c[0]);
    expect(calledCmds.some((c) => c.startsWith('gh pr close 2000'))).toBe(true);
    // 确认没有误走 CI 判断路径
    expect(calledCmds.some((c) => c.startsWith('gh pr checks 2000'))).toBe(false);
  });
});
