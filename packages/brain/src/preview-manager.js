import pool from './db.js';

const PORT_MIN = 5300;
const PORT_MAX = 5399;

/**
 * 为 PR 分配端口 + 创建 preview_environments 记录（status='starting'）。
 * 返回 { port, db_name }。
 */
export async function allocatePreview(prNumber, branchName, baseRepo = 'cecelia', dbPool = pool) {
  // 已存在活跃记录时复用（幂等，支持重推）
  const existing = await dbPool.query(
    `SELECT port, db_name FROM preview_environments
     WHERE pr_number = $1 AND status != 'inactive'`,
    [prNumber],
  );
  if (existing.rows.length > 0) {
    return { port: existing.rows[0].port, db_name: existing.rows[0].db_name };
  }

  const used = await dbPool.query(
    `SELECT port FROM preview_environments WHERE status != 'inactive'`,
  );
  const usedPorts = new Set(used.rows.map((r) => r.port));
  let port = null;
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!usedPorts.has(p)) { port = p; break; }
  }
  if (!port) throw new Error('preview port pool exhausted (5300-5399 all active)');

  const dbName = `cecelia_preview_${prNumber}`;
  await dbPool.query(
    `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
     VALUES ($1, $2, $3, $4, $5, 'starting')`,
    [prNumber, branchName, baseRepo, port, dbName],
  );
  return { port, db_name: dbName };
}

/** 将 preview 标记为 active（Brain 进程已就绪）。 */
export async function markPreviewActive(prNumber, dbPool = pool) {
  await dbPool.query(
    `UPDATE preview_environments SET status = 'active', updated_at = NOW()
     WHERE pr_number = $1`,
    [prNumber],
  );
}

/** 将 preview 标记为 inactive（清理完成）。 */
export async function markPreviewInactive(prNumber, dbPool = pool) {
  await dbPool.query(
    `UPDATE preview_environments SET status = 'inactive', updated_at = NOW()
     WHERE pr_number = $1`,
    [prNumber],
  );
}

/** 查询 preview 状态，未找到返回 null。 */
export async function getPreview(prNumber, dbPool = pool) {
  const { rows } = await dbPool.query(
    `SELECT * FROM preview_environments WHERE pr_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [prNumber],
  );
  return rows[0] ?? null;
}

// --- 向后兼容接口（旧测试用，保留但废弃） ---

/** @deprecated 使用 allocatePreview */
export async function allocatePort(prNumber, branchName, baseRepo, dbPool = pool) {
  const { port } = await allocatePreview(prNumber, branchName, baseRepo, dbPool);
  return port;
}

/** @deprecated 使用 markPreviewInactive */
export async function stopPreview(prNumber, dbPool = pool) {
  await markPreviewInactive(prNumber, dbPool);
}
