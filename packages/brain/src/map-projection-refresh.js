/**
 * map-projection-refresh.js — 地图投影保鲜 job(Crystal 件9,决策 8f22f71c)
 *
 * 病根(09-05/06 生产两轮实证):fact_snapshot_headers 由扫描链每 ~5min 自动刷新,
 * 而 map 投影(map_projection_runs)的换代旧靠 kernel 活跃期节奏,kernel 闲置即停转
 * (08-30 起)。二者脱钩后,kernel 派发 preflight 里 radius 新鲜度取投影权威的
 * source_revision,与派发时解析的 base_sha 必然不等 → 确定性 map_radius_stale。
 *
 * 修法:照 gp-shelf-life/receipt-collector 的自 gate 模式,周期比较各 active scope 的
 * headers revision 与投影 fact_revisions,漂移即调 map-read-service.rebuild。
 * 手动应急 SOP(job 挂掉时):POST /api/brain/map/rebuild body {"scope_key":"cecelia"}。
 */
import { rebuild } from './lib/map-read-service.js';

/** 与 lib/map-read-service.js 的 REQUIRED_FACT_KINDS 语义一致(radius 新鲜度四件套) */
const REQUIRED_FACT_KINDS = ['api', 'db_schema', 'graph', 'test'];

const DEFAULT_INTERVAL_MS = parseInt(
  process.env.CECELIA_MAP_PROJECTION_REFRESH_INTERVAL_MS || String(3 * 60 * 1000),
  10,
);

let lastRunAt = 0;

/** 单 repo 判定:四 kind 齐且同 revision → 返回该 revision;否则 null(扫描中窗口) */
function settledHeaderRevision(headerRows) {
  const byKind = new Map(headerRows.map((row) => [row.kind, row.source_revision]));
  const revisions = new Set();
  for (const kind of REQUIRED_FACT_KINDS) {
    const rev = byKind.get(kind);
    if (!rev) return null;
    revisions.add(rev);
  }
  return revisions.size === 1 ? [...revisions][0] : null;
}

/**
 * 周期入口(scheduler-jobs 每 60s 调,自 gate 默认 3min)。
 * 依赖全部可注入,测试零真库。
 */
export async function maybeRefreshMapProjections(pool, {
  rebuildFn = rebuild,
  now = Date.now,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  if (now() - lastRunAt < intervalMs) return { skipped: true };
  lastRunAt = now();

  const { rows: projections } = await pool.query(
    `SELECT scope_key, fact_revisions FROM map_projection_runs WHERE status = 'active'`,
  );

  const rebuilt = [];
  const failed = [];
  const skippedScopes = [];

  for (const projection of projections) {
    const scopeKey = projection.scope_key;
    const { rows: repoRows } = await pool.query(
      'SELECT repo FROM map_scope_repositories WHERE scope_key = $1',
      [scopeKey],
    );
    const repos = repoRows.map((row) => row.repo);
    if (repos.length === 0) continue;

    const { rows: headerRows } = await pool.query(
      `SELECT repo, kind, source_revision FROM fact_snapshot_headers WHERE repo = ANY($1::text[])`,
      [repos],
    );

    let drift = false;
    let incomplete = false;
    for (const repo of repos) {
      const headerRev = settledHeaderRevision(headerRows.filter((row) => row.repo === repo));
      if (headerRev == null) { incomplete = true; break; }
      const projectionRev = projection.fact_revisions?.[repo] ?? null;
      if (headerRev !== projectionRev) drift = true;
    }
    if (incomplete) {
      // 扫描进行中的正常窗口:本轮不动,下轮再看(不报错,防噪音)
      skippedScopes.push({ scope_key: scopeKey, reason: 'headers_incomplete' });
      continue;
    }
    if (!drift) continue;

    try {
      await rebuildFn(pool, { scopeKey, now: new Date() });
      rebuilt.push(scopeKey);
      console.log(`[map-projection-refresh] scope=${scopeKey} 投影已随 fact revision 重建`);
    } catch (error) {
      // 失败必留原因,且单 scope 失败不连坐其余 scope
      failed.push({ scope_key: scopeKey, error: error.message });
      console.error(
        `[map-projection-refresh] scope=${scopeKey} rebuild 失败: ${error.message}`
        + `(projection=${JSON.stringify(projection.fact_revisions)})`,
      );
    }
  }

  return {
    skipped: false,
    checked: projections.length,
    rebuilt,
    failed,
    skipped_scopes: skippedScopes,
  };
}

/** 测试专用:重置模块级 gate(生产不调) */
export function __resetRefreshGateForTest() {
  lastRunAt = 0;
}
