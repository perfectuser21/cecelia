/**
 * capacity-gate.js — 容量准入闸门
 *
 * readHostDisk(path?)      — 读取 host-disk-sampler.sh 落盘的采样文件，做新鲜度/完整性校验。
 * admitPreview(...)        — preview 创建前的四层准入判定 + pg_advisory_xact_lock 并发串行化 +
 *                             幂等复用（已存在活跃记录的 PR 重推直接放行）。
 *
 * 设计决策（GAN Round 1 Reviewer 反馈问题2 修复 — 方案A）：admitPreview() 不是纯判定函数，
 * 判定 + 端口扫描 + INSERT 全程包在同一个 pg_advisory_xact_lock 事务内，消除 TOCTOU 竞态。
 *
 * 禁 mock 边（合同）：本文件 ↔ 真实 Postgres（preview_environments 读 + advisory lock）、
 * 本文件 ↔ 文件系统（.runtime/host-disk.json 读取），测试须真连真读，不 mock。
 * 本文件不直接调用 df/diskutil（T10 消费者代码约束）——磁盘采样唯一由 scripts/host-disk-sampler.sh 执行。
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/brain/src → 仓库根目录（3 层）
const REPO_ROOT = process.env.CECELIA_DEPLOY_ROOT || process.env.REPO_ROOT || join(__dirname, '../../../');
const DEFAULT_SAMPLE_PATH = join(REPO_ROOT, '.runtime', 'host-disk.json');

export const GIB = 1073741824;
export const SAMPLE_STALE_SECONDS = 180;
export const CAPACITY_RESERVE_BYTES = 3.5 * GIB; // 3.5 GiB
export const CAPACITY_FLOOR_BYTES = 35 * GIB; // 35 GiB
export const USAGE_PCT_LIMIT = 85;
export const MAX_ACTIVE_PREVIEWS = 6;
// PRD 未给出精确数值，定为固定常量供上游决策参考（worktree + 隔离DB 历史平均量级估计）
export const PREVIEW_ESTIMATED_COST_BYTES = 2 * GIB;

const PORT_MIN = 5300;
const PORT_MAX = 5399;

const REQUIRED_SAMPLE_FIELDS = [
  'sampled_at_epoch',
  'data_avail_bytes',
  'apfs_unallocated_bytes',
  'effective_free_bytes',
  'usage_pct',
];

/**
 * 读取并校验宿主磁盘采样文件。
 * @param {string} [samplePath] - 采样文件路径，缺省用生产默认路径
 * @returns {Promise<{ok:true,data:object}|{ok:false,reason:string}>}
 */
export async function readHostDisk(samplePath) {
  const p = samplePath || DEFAULT_SAMPLE_PATH;

  let raw;
  try {
    raw = await readFile(p, 'utf8');
  } catch {
    return { ok: false, reason: 'sample_missing' };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'sample_corrupt' };
  }

  for (const field of REQUIRED_SAMPLE_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      return { ok: false, reason: 'sample_incomplete' };
    }
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (nowEpoch - data.sampled_at_epoch > SAMPLE_STALE_SECONDS) {
    return { ok: false, reason: 'sample_stale' };
  }

  return {
    ok: true,
    data: {
      sampled_at_epoch: data.sampled_at_epoch,
      data_avail_bytes: data.data_avail_bytes,
      apfs_unallocated_bytes: data.apfs_unallocated_bytes,
      effective_free_bytes: data.effective_free_bytes,
      usage_pct: data.usage_pct,
    },
  };
}

/** layer1（样本无效）拒绝时触发 Bark 告警，防静默瘫痪。best-effort，绝不抛异常阻断主流程。 */
async function alertSampleInvalid(reason) {
  try {
    const { sendBark } = await import('./notifier.js');
    await sendBark(
      'Preview 准入告警',
      `宿主磁盘采样无效（${reason}），admitPreview 已拒绝创建以防静默瘫痪`,
      { dedupeKey: `capacity-gate-sample-${reason}`, dedupeTtlSec: 300 },
    );
  } catch {
    // 通知通道不可用不应影响准入判定本身
  }
}

function rejection(reason, freeBytes) {
  return {
    admitted: false,
    reason,
    free_bytes: freeBytes ?? null,
    projected_cost_bytes: PREVIEW_ESTIMATED_COST_BYTES,
    need_release_bytes: 0,
  };
}

/**
 * preview 准入判定 + 端口扫描 + INSERT（同一把 pg_advisory_xact_lock 事务内完成，消除 TOCTOU）。
 * @param {number} prNumber
 * @param {string} branchName
 * @param {string} baseRepo
 * @param {import('pg').Pool} dbPool
 * @param {{samplePath?: string}} [opts]
 * @returns {Promise<{admitted:true,port:number,db_name:string}|{admitted:false,reason:string,free_bytes:number|null,projected_cost_bytes:number,need_release_bytes:number}>}
 */
export async function admitPreview(prNumber, branchName, baseRepo, dbPool = pool, opts = {}) {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    // 全局固定 key（同一把锁串行化全部准入判定 + 预留），事务提交/回滚时自动释放
    await client.query("SELECT pg_advisory_xact_lock(hashtext('preview_admission')::bigint)");

    // ── 幂等复用：已存在活跃记录（status != 'inactive'）的 PR 重推，跳过四层判定直接放行 ──
    const existing = await client.query(
      `SELECT port, db_name FROM preview_environments WHERE pr_number = $1 AND status != 'inactive'`,
      [prNumber],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE preview_environments
            SET status = 'starting', updated_at = NOW()
          WHERE pr_number = $1
            AND status != 'inactive'`,
        [prNumber],
      );
      await client.query('COMMIT');
      return { admitted: true, port: existing.rows[0].port, db_name: existing.rows[0].db_name };
    }

    // ── layer1：采样新鲜度/完整性 ──
    const sample = await readHostDisk(opts.samplePath);
    if (!sample.ok) {
      await client.query('ROLLBACK');
      await alertSampleInvalid(sample.reason);
      return rejection(sample.reason, null);
    }
    const { effective_free_bytes: freeBytes, usage_pct: usagePct } = sample.data;

    // ── layer2：数量红线 ──
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM preview_environments WHERE status IN ('active','starting','cleaning')`,
    );
    if (countRes.rows[0].n >= MAX_ACTIVE_PREVIEWS) {
      await client.query('ROLLBACK');
      return rejection('too_many_active', freeBytes);
    }

    // ── layer3：容量红线（字节级比较）──
    if (freeBytes - CAPACITY_RESERVE_BYTES < CAPACITY_FLOOR_BYTES) {
      await client.query('ROLLBACK');
      const needRelease = Math.max(0, (CAPACITY_FLOOR_BYTES + CAPACITY_RESERVE_BYTES) - freeBytes);
      return {
        admitted: false,
        reason: 'insufficient_free_space',
        free_bytes: freeBytes,
        projected_cost_bytes: PREVIEW_ESTIMATED_COST_BYTES,
        need_release_bytes: needRelease,
      };
    }

    // ── layer4：usage_pct 红线 ──
    if (usagePct >= USAGE_PCT_LIMIT) {
      await client.query('ROLLBACK');
      return rejection('usage_pct_too_high', freeBytes);
    }

    // ── 全部通过：同一把锁内扫描空闲端口 + INSERT ──
    const usedRes = await client.query(`SELECT port FROM preview_environments WHERE status != 'inactive'`);
    const usedPorts = new Set(usedRes.rows.map((r) => r.port));
    let port = null;
    for (let p = PORT_MIN; p <= PORT_MAX; p++) {
      if (!usedPorts.has(p)) { port = p; break; }
    }
    if (!port) {
      await client.query('ROLLBACK');
      return rejection('too_many_active', freeBytes);
    }

    const dbName = `cecelia_preview_${prNumber}`;
    await client.query(
      `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
       VALUES ($1, $2, $3, $4, $5, 'starting')`,
      [prNumber, branchName, baseRepo, port, dbName],
    );
    await client.query('COMMIT');
    return { admitted: true, port, db_name: dbName };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be broken */ }
    throw err;
  } finally {
    client.release();
  }
}
