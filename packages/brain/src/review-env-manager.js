/**
 * Review Environment Manager
 *
 * Allocates and releases localhost ports (5300-5399) for Dashboard static review servers.
 * Each evaluator-PASS'd initiative gets a port; shepherd cleans up on PR close.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT_MIN = 5300;
const PORT_MAX = 5399;

// Use globalThis so the registry survives vi.resetModules() in test suites
if (!globalThis._reviewEnvServers) globalThis._reviewEnvServers = new Map();
const _serverRegistry = globalThis._reviewEnvServers;

/**
 * Find a free port in [5300-5399] by querying DB for occupied ports.
 * Returns null if all ports are occupied.
 * @param {object} pool - pg Pool
 * @returns {Promise<number|null>}
 */
export async function findFreePort(pool) {
  const { rows } = await pool.query('SELECT port FROM review_environments');
  const occupied = new Set(rows.map(r => r.port));
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!occupied.has(p)) return p;
  }
  return null;
}

/**
 * Start a Node.js static file server for the given dist directory on the given port.
 * Returns the server instance. The "pid" stored in DB is the port number (used as handle).
 * @param {string} distDir
 * @param {number} port
 * @returns {http.Server}
 */
function startStaticServer(distDir, port) {
  // Close any existing server bound to this port in our registry (test isolation)
  if (_serverRegistry.has(port)) {
    try { _serverRegistry.get(port).close(); } catch {}
    _serverRegistry.delete(port);
  }

  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(distDir, urlPath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  server.listen(port);
  _serverRegistry.set(port, server);
  return server;
}

function defaultKillPid(pid) {
  // In-process servers: pid is stored as the port number (handle into _serverRegistry)
  const server = _serverRegistry.get(pid);
  if (server) {
    server.close();
    _serverRegistry.delete(pid);
  }
}

/**
 * Allocate a review environment for an initiative.
 * - If dist_dir doesn't exist → { skipped: true, port: null, pid: null }
 * - If ports exhausted → { skipped: true, port: null, pid: null }
 * - If initiative already has an env → release old, then allocate new
 *
 * @param {string} initiativeId
 * @param {object} pool - pg Pool
 * @param {{ distDir?: string, _killPid?: Function }} opts
 */
export async function allocateReviewEnv(initiativeId, pool, opts = {}) {
  const distDir = opts.distDir ?? path.join(process.cwd(), 'apps/dashboard/dist');
  const killPid = opts._killPid ?? defaultKillPid;

  // Check dist dir exists
  if (!fs.existsSync(distDir)) {
    console.log(`[review-env] Dashboard dist 目录不存在，跳过: ${distDir}`);
    return { initiative_id: initiativeId, skipped: true, port: null, pid: null };
  }

  // Check for existing allocation for this initiative → release old first
  const existing = await pool.query(
    'SELECT initiative_id, port, pid FROM review_environments WHERE initiative_id = $1',
    [initiativeId]
  );
  if (existing.rows.length > 0) {
    const old = existing.rows[0];
    try { killPid(old.pid); } catch {}
    await pool.query('DELETE FROM review_environments WHERE initiative_id = $1', [initiativeId]);
  }

  // Find free port
  const port = await findFreePort(pool);
  if (port === null) {
    console.log('[review-env] 端口耗尽（5300-5399 已满）');
    return { initiative_id: initiativeId, skipped: true, port: null, pid: null };
  }

  let storedPid;
  if (opts._killPid) {
    // Test mode with injected kill: don't start a real server, use a fake pid
    storedPid = 99998;
  } else {
    // Production mode: start real in-process server, use port as pid handle
    startStaticServer(distDir, port);
    storedPid = port;
  }

  await pool.query(
    'INSERT INTO review_environments (initiative_id, port, pid) VALUES ($1, $2, $3)',
    [initiativeId, port, storedPid]
  );

  console.log(`[review-env] 分配端口 ${port} → initiative ${initiativeId}`);
  return { initiative_id: initiativeId, port, pid: storedPid, skipped: false };
}

/**
 * Release a review environment for an initiative.
 * Idempotent: returns { released: true } even if no record found.
 *
 * @param {string} initiativeId
 * @param {object} pool
 * @param {{ _killPid?: Function }} opts
 */
export async function releaseReviewEnv(initiativeId, pool, opts = {}) {
  const killPid = opts._killPid ?? defaultKillPid;

  const { rows } = await pool.query(
    'SELECT initiative_id, port, pid FROM review_environments WHERE initiative_id = $1',
    [initiativeId]
  );

  if (rows.length > 0) {
    const { pid } = rows[0];
    try { killPid(pid); } catch (err) {
      console.warn(`[review-env] kill pid ${pid} failed (process may be dead): ${err.message}`);
    }
    await pool.query('DELETE FROM review_environments WHERE initiative_id = $1', [initiativeId]);
    console.log(`[review-env] 释放 → initiative ${initiativeId}`);
  }

  return { released: true, initiative_id: initiativeId };
}

/**
 * Cleanup review environments for initiatives in done/failed phase.
 * Called by shepherd on each tick. Directly kills pids from JOIN result.
 *
 * @param {object} pool
 * @param {{ _killPid?: Function }} opts
 * @returns {Promise<number>} count of released environments
 */
export async function cleanupHarnessReviewEnvs(pool, opts = {}) {
  const killPid = opts._killPid ?? defaultKillPid;

  const { rows } = await pool.query(`
    SELECT re.initiative_id, re.port, re.pid
    FROM review_environments re
    JOIN initiative_runs ir ON ir.initiative_id::text = re.initiative_id::text
    WHERE ir.phase IN ('done', 'failed')
  `);

  let released = 0;
  for (const row of rows) {
    try { killPid(row.pid); } catch {}
    await pool.query('DELETE FROM review_environments WHERE initiative_id = $1', [row.initiative_id]);
    released++;
  }

  return released;
}
