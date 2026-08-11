// map_projection_nodes / map_projection_edges 的真实结构见
// packages/brain/migrations/405_map_projection_core.sql。
//
// - node_type 的合法值是该表 CHECK 约束里写死的 8 个：value_stream / capability /
//   crosscut / prerequisite / backbone / feature / artifact / assertion。
//   （不是 'cross_cut' / 'boundary' 这种猜测拼法——两者都不在 CHECK 里。）
// - edge_type 的合法值是另外 9 个：contains / hands_off_to / serves / requires /
//   precedes / implements / proves / affects / owned_by。
// - 两张表的主键都是 (run_id, node_id/edge_id)，行永远挂在某次具体的 projection run
//   下；被 superseded 的旧 run 产生的行不会自动清掉（要等 run 行被删除触发
//   ON DELETE CASCADE，见 map-summary.js 里对同一问题的注释）。所以"查看某类节点/边
//   的明细"跟 getMapSummary 的统计一样，理论上也应该限定在当前 active run 范围内，
//   否则会把历史上跑过的所有 run（含已废弃）的行混在一起返回。
//
//   这里的取舍：activeRunId 作为第 5 个参数存在——调用方（server.js，Task 11）会先查
//   一次 map_projection_runs 的 active 行拿到 id 再传进来，由这一层把它拼进 WHERE 条件；
//   本函数自己不去查 active run（避免每次调用这两个工具都多打一次 DB，server.js 可以
//   在一次请求里查一次 active run 后被多个工具复用）。
//
//   fail-closed：`undefined`（调用方根本没传这个参数——最常见的疏忽场景）与显式 `null`
//   （调用方明确要"跨全部 run 查询历史"）是两种不同语义，不能混为一谈，否则 Task 11
//   接线时如果忘了传第 5 个参数，不会报错、不会崩溃，只会安静地把历史 superseded run
//   的节点/边也混进结果——这跟 map-summary.js 里 getMapSummary 内部强制查 active run
//   的 fail-closed 做法不一致，是有安全隐患的默认值。所以这里强制每个调用点做出有意识
//   的选择：
//     - activeRunId === undefined → 抛 ValidationError，逼调用方显式决定
//     - activeRunId === null      → 不加 run_id 过滤，跨全部 run 查询（有意为之）
//     - activeRunId 是具体值      → 加 `AND run_id = $N`
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'invalid_params';
  }
}

// 与 405 migration 里 CHECK (node_type IN (...)) 逐字对齐。
export const NODE_TYPES = [
  'value_stream',
  'capability',
  'crosscut',
  'prerequisite',
  'backbone',
  'feature',
  'artifact',
  'assertion',
];

// 与 405 migration 里 CHECK (edge_type IN (...)) 逐字对齐。
export const EDGE_TYPES = [
  'contains',
  'hands_off_to',
  'serves',
  'requires',
  'precedes',
  'implements',
  'proves',
  'affects',
  'owned_by',
];

function normalizeLimit(limit) {
  if (limit === undefined) return 50;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    throw new ValidationError('limit 必须是正数');
  }
  return Math.min(limit, 200);
}

function buildRunScopedQuery(table, typeColumn, typeValue, safeLimit, activeRunId) {
  if (activeRunId === undefined) {
    throw new ValidationError(
      '必须显式指定 activeRunId，若要跨全部 run 查询请显式传 null'
    );
  }

  const conditions = [`${typeColumn} = $1`];
  const params = [typeValue];

  if (activeRunId !== null) {
    params.push(activeRunId);
    conditions.push(`run_id = $${params.length}`);
  }

  params.push(safeLimit);

  return {
    sql: `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT $${params.length}`,
    params,
  };
}

export async function getMapNodes(pool, queryFn, { node_type, limit } = {}, validTypes, activeRunId) {
  if (!Array.isArray(validTypes) || !validTypes.includes(node_type)) {
    throw new ValidationError(`node_type 必须是 ${(validTypes || []).join('/')} 之一`);
  }
  const safeLimit = normalizeLimit(limit);
  const { sql, params } = buildRunScopedQuery(
    'map_projection_nodes',
    'node_type',
    node_type,
    safeLimit,
    activeRunId
  );
  return queryFn(pool, sql, params);
}

export async function getMapEdges(pool, queryFn, { edge_type, limit } = {}, validTypes, activeRunId) {
  if (!Array.isArray(validTypes) || !validTypes.includes(edge_type)) {
    throw new ValidationError(`edge_type 必须是 ${(validTypes || []).join('/')} 之一`);
  }
  const safeLimit = normalizeLimit(limit);
  const { sql, params } = buildRunScopedQuery(
    'map_projection_edges',
    'edge_type',
    edge_type,
    safeLimit,
    activeRunId
  );
  return queryFn(pool, sql, params);
}
