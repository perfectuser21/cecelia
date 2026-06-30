import pool from './db.js';

const PORT_MIN = 5300;
const PORT_MAX = 5399;

export async function allocatePort(prNumber, branchName, baseRepo, dbPool = pool) {
  const used = await dbPool.query(
    "SELECT port FROM preview_environments WHERE status='active'"
  );
  const usedPorts = new Set(used.rows.map(r => r.port));
  let port = null;
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!usedPorts.has(p)) { port = p; break; }
  }
  if (!port) throw new Error('preview port pool exhausted (5300-5399 all active)');

  await dbPool.query(
    `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port)
     VALUES ($1, $2, $3, $4)`,
    [prNumber, branchName, baseRepo, port]
  );
  return port;
}

export async function stopPreview(prNumber, dbPool = pool) {
  await dbPool.query(
    `UPDATE preview_environments
     SET status='stopped', stopped_at=NOW()
     WHERE pr_number=$1 AND status='active'`,
    [prNumber]
  );
}
