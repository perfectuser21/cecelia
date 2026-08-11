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
//   这里的取舍：activeRunId 作为可选的第 5 个参数存在——调用方（server.js，Task 11）
//   会先查一次 map_projection_runs 的 active 行拿到 id 再传进来，由这一层把它拼进
//   WHERE 条件；本函数自己不去查 active run（避免每次调用这两个工具都多打一次 DB，
//   server.js 可以在一次请求里查一次 active run 后被多个工具复用）。activeRunId 省略
//   或传 null 时不加这层过滤，语义上等价于"跨全部 run 查询"，留给明确需要这种查法的
//   调用方；Task 11 接线时应当始终传入 active run id 以保证"当前状态快照"语义。
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
  const conditions = [`${typeColumn} = $1`];
  const params = [typeValue];

  if (activeRunId !== undefined && activeRunId !== null) {
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
