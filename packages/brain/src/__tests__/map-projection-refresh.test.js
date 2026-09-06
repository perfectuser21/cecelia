/**
 * map-projection-refresh.test.js — Crystal 件9 回归测试(regression,永久留 CI)
 *
 * 案卷:09-05/06 生产两轮实证——fact_snapshot_headers 每~5min 自动刷新而 map 投影
 * 自 08-30 无人重建,二者脱钩 → kernel 派发 preflight 确定性抛 map_radius_stale。
 * 修法 = scheduler job:漂移即调 map-read-service.rebuild。决策 8f22f71c。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maybeRefreshMapProjections, __resetRefreshGateForTest } from '../map-projection-refresh.js';

beforeEach(() => __resetRefreshGateForTest());

const KINDS = ['api', 'db_schema', 'graph', 'test'];
const REV_OLD = '1ef19bd6f70b79e14a20ecb0e37ba8492f71a029';
const REV_NEW = '3d37458143f0f90ac8f4eaded94d374696851ea0';

/** pool stub:按 SQL 关键词路由到 stub 数据 */
function makePool({ projections, headersByRepo }) {
  return {
    query: vi.fn(async (sql, params) => {
      if (/map_projection_runs/.test(sql)) return { rows: projections };
      if (/map_scope_repositories/.test(sql)) {
        const scope = params?.[0];
        const repos = projections
          .filter((p) => p.scope_key === scope)
          .flatMap((p) => Object.keys(p.fact_revisions ?? {}));
        return { rows: repos.map((repo) => ({ repo })) };
      }
      if (/fact_snapshot_headers/.test(sql)) {
        const repos = params?.[0] ?? [];
        const rows = [];
        for (const repo of repos) {
          for (const h of headersByRepo[repo] ?? []) rows.push({ repo, ...h });
        }
        return { rows };
      }
      throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
    }),
  };
}

const fullHeaders = (rev) => KINDS.map((kind) => ({ kind, source_revision: rev }));

function baseOpts(overrides = {}) {
  let t = 1_000_000;
  return {
    rebuildFn: vi.fn(async () => ({ rebuilt: true })),
    now: () => t,
    advance: (ms) => { t += ms; },
    intervalMs: 180_000,
    ...overrides,
  };
}

describe('maybeRefreshMapProjections', () => {
  it('投影 fact_revisions 旧于 headers → 恰好调用 rebuild 一次且带对 scope_key', async () => {
    const pool = makePool({
      projections: [{ scope_key: 'cecelia', fact_revisions: { cecelia: REV_OLD } }],
      headersByRepo: { cecelia: fullHeaders(REV_NEW) },
    });
    const opts = baseOpts();
    const r = await maybeRefreshMapProjections(pool, opts);
    expect(opts.rebuildFn).toHaveBeenCalledTimes(1);
    expect(opts.rebuildFn.mock.calls[0][1]).toMatchObject({ scopeKey: 'cecelia' });
    expect(r.rebuilt).toEqual(['cecelia']);
  });

  it('revision 对齐 → 绝不调用 rebuild', async () => {
    const pool = makePool({
      projections: [{ scope_key: 'cecelia', fact_revisions: { cecelia: REV_NEW } }],
      headersByRepo: { cecelia: fullHeaders(REV_NEW) },
    });
    const opts = baseOpts();
    const r = await maybeRefreshMapProjections(pool, opts);
    expect(opts.rebuildFn).not.toHaveBeenCalled();
    expect(r.rebuilt).toEqual([]);
  });

  it('四 kind revision 不一致(扫描中窗口)→ 跳过该 scope 不重建、不报错', async () => {
    const mixed = [
      { kind: 'api', source_revision: REV_NEW },
      { kind: 'db_schema', source_revision: REV_NEW },
      { kind: 'graph', source_revision: REV_OLD }, // 扫描进行中
      { kind: 'test', source_revision: REV_NEW },
    ];
    const pool = makePool({
      projections: [{ scope_key: 'cecelia', fact_revisions: { cecelia: REV_OLD } }],
      headersByRepo: { cecelia: mixed },
    });
    const opts = baseOpts();
    const r = await maybeRefreshMapProjections(pool, opts);
    expect(opts.rebuildFn).not.toHaveBeenCalled();
    expect(r.skipped_scopes).toEqual([
      expect.objectContaining({ scope_key: 'cecelia', reason: 'headers_incomplete' }),
    ]);
  });

  it('缺 kind → 同样跳过该 scope(headers_incomplete)', async () => {
    const pool = makePool({
      projections: [{ scope_key: 'cecelia', fact_revisions: { cecelia: REV_OLD } }],
      headersByRepo: { cecelia: fullHeaders(REV_NEW).slice(0, 3) }, // 缺 test kind
    });
    const opts = baseOpts();
    await maybeRefreshMapProjections(pool, opts);
    expect(opts.rebuildFn).not.toHaveBeenCalled();
  });

  it('间隔 gate:窗口内第二次调用 → skipped,不查库不重建;过窗恢复', async () => {
    const pool = makePool({
      projections: [{ scope_key: 'cecelia', fact_revisions: { cecelia: REV_OLD } }],
      headersByRepo: { cecelia: fullHeaders(REV_NEW) },
    });
    const opts = baseOpts();
    await maybeRefreshMapProjections(pool, opts);          // 第一次:重建
    const callsAfterFirst = pool.query.mock.calls.length;
    opts.advance(60_000);                                   // 仅过 1min < 3min gate
    const r2 = await maybeRefreshMapProjections(pool, opts);
    expect(r2.skipped).toBe(true);
    expect(pool.query.mock.calls.length).toBe(callsAfterFirst); // 没碰库
    expect(opts.rebuildFn).toHaveBeenCalledTimes(1);
    opts.advance(180_000);                                  // 过窗后恢复工作
    const r3 = await maybeRefreshMapProjections(pool, opts);
    expect(r3.skipped).toBeFalsy();
  });

  it('双 scope、第一个 rebuild 抛错 → 第二个照常重建(失败不连坐、留原因)', async () => {
    const pool = makePool({
      projections: [
        { scope_key: 'cecelia', fact_revisions: { cecelia: REV_OLD } },
        { scope_key: 'zenithjoy-workspace', fact_revisions: { 'zenithjoy-workspace': REV_OLD } },
      ],
      headersByRepo: {
        cecelia: fullHeaders(REV_NEW),
        'zenithjoy-workspace': fullHeaders(REV_NEW),
      },
    });
    const opts = baseOpts({
      rebuildFn: vi.fn(async (_pool, { scopeKey }) => {
        if (scopeKey === 'cecelia') throw new Error('boom');
        return { rebuilt: true };
      }),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await maybeRefreshMapProjections(pool, opts);
    expect(opts.rebuildFn).toHaveBeenCalledTimes(2);
    expect(r.rebuilt).toEqual(['zenithjoy-workspace']);
    expect(r.failed).toEqual([expect.objectContaining({ scope_key: 'cecelia' })]);
    expect(errSpy).toHaveBeenCalled(); // 失败必留原因
    errSpy.mockRestore();
  });
});
