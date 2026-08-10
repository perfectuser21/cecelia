/**
 * contract-store.js — Impact Contract 持久化层（FR-2）
 *
 * 提供 Impact Contract 的 CRUD 操作，封装事务逻辑与幂等去重。
 *
 * 持久化规则：
 * - 同 (task_id, contract_hash) 幂等：返回已有记录，不重复插入
 * - 新 hash：将同 task 旧 active 合同标为 superseded，再插入 version+1
 * - 所有写操作在事务内执行
 *
 * sprint: 08110022-relay-d96c9fa0 ws2
 */

import { createHash } from 'crypto';
import _pool from '../db.js';

// ---------- 工具函数 ----------

/**
 * computeContractHash(contractBody) — 计算合同内容的 SHA-256 哈希。
 *
 * @param {object} contractBody
 * @returns {string} hex 字符串
 */
export function computeContractHash(contractBody) {
  const canonical = JSON.stringify(contractBody, Object.keys(contractBody).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------- 写操作 ----------

/**
 * persistImpactContract(db, input) — 持久化 Impact Contract。
 *
 * 幂等语义：
 * - 若 (task_id, contract_hash) 已存在 → 返回 { contract, created: false }
 * - 若 hash 不同 → 旧 active 标为 superseded，插入新版本
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db  DB 连接或 pool
 * @param {{
 *   task_id: string,
 *   change_kind: string,
 *   repo?: string,
 *   base_revision: string,
 *   head_revision?: string,
 *   manifest_digest?: string,
 *   projection_digest?: string,
 *   contract_body: object,
 * }} input
 * @returns {Promise<{ contract: object, created: boolean }>}
 */
export async function persistImpactContract(db, input) {
  const {
    task_id,
    change_kind,
    repo = null,
    base_revision,
    head_revision = null,
    manifest_digest = null,
    projection_digest = null,
    contract_body,
  } = input;

  const contract_hash = computeContractHash(contract_body);

  // 使用事务（若 db 为 Pool，先 connect；若为 Client 则直接用）
  const isPool = typeof db.connect === 'function' && typeof db.query === 'function' && db.constructor?.name !== 'Client';
  const client = isPool ? await db.connect() : db;

  try {
    if (isPool) await client.query('BEGIN');

    // 幂等检查：同 (task_id, contract_hash) 是否已存在
    const existingRes = await client.query(
      `SELECT * FROM harness_impact_contracts
       WHERE task_id = $1 AND contract_hash = $2
       LIMIT 1`,
      [task_id, contract_hash]
    );

    if (existingRes.rows.length > 0) {
      if (isPool) await client.query('COMMIT');
      return { contract: existingRes.rows[0], created: false };
    }

    // 查当前最大 version 及 active 合同
    const versionRes = await client.query(
      `SELECT MAX(version) AS max_version,
              (SELECT id FROM harness_impact_contracts
               WHERE task_id = $1 AND status = 'active'
               LIMIT 1) AS active_id
       FROM harness_impact_contracts
       WHERE task_id = $1`,
      [task_id]
    );

    const maxVersion = versionRes.rows[0]?.max_version ?? 0;
    const activeId = versionRes.rows[0]?.active_id ?? null;
    const newVersion = maxVersion + 1;

    // 将旧 active 合同标为 superseded
    if (activeId) {
      await client.query(
        `UPDATE harness_impact_contracts
         SET status = 'superseded'
         WHERE id = $1`,
        [activeId]
      );
    }

    // 插入新版本合同
    const insertRes = await client.query(
      `INSERT INTO harness_impact_contracts (
         task_id, version, status, schema_version,
         change_kind, repo, base_revision, head_revision,
         manifest_digest, projection_digest,
         contract_hash, contract_body, supersedes_id
       ) VALUES (
         $1, $2, 'active', 1,
         $3, $4, $5, $6,
         $7, $8,
         $9, $10, $11
       )
       RETURNING *`,
      [
        task_id,
        newVersion,
        change_kind,
        repo,
        base_revision,
        head_revision,
        manifest_digest,
        projection_digest,
        contract_hash,
        JSON.stringify(contract_body),
        activeId,
      ]
    );

    if (isPool) await client.query('COMMIT');
    return { contract: insertRes.rows[0], created: true };
  } catch (err) {
    if (isPool) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isPool) client.release();
  }
}

// ---------- 读操作 ----------

/**
 * getActiveImpactContract(db, taskId) — 查询指定 task 的 active 合同。
 *
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<object|null>}
 */
export async function getActiveImpactContract(db, taskId) {
  const res = await db.query(
    `SELECT * FROM harness_impact_contracts
     WHERE task_id = $1 AND status = 'active'
     ORDER BY version DESC
     LIMIT 1`,
    [taskId]
  );
  return res.rows[0] ?? null;
}

/**
 * getImpactContractById(db, contractId) — 按 id 查询合同。
 *
 * @param {import('pg').Pool} db
 * @param {string} contractId
 * @returns {Promise<object|null>}
 */
export async function getImpactContractById(db, contractId) {
  const res = await db.query(
    `SELECT * FROM harness_impact_contracts
     WHERE id = $1
     LIMIT 1`,
    [contractId]
  );
  return res.rows[0] ?? null;
}

/**
 * listImpactContracts(db, taskId) — 列出某 task 的所有合同版本（按版本升序）。
 *
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<object[]>}
 */
export async function listImpactContracts(db, taskId) {
  const res = await db.query(
    `SELECT * FROM harness_impact_contracts
     WHERE task_id = $1
     ORDER BY version ASC`,
    [taskId]
  );
  return res.rows;
}

// ---------- 失效操作 ----------

/**
 * invalidateImpactContract(db, { taskId, reason, expectedHash }) — 使当前 active 合同失效。
 *
 * @param {import('pg').Pool} db
 * @param {{ taskId: string, reason?: string, expectedHash?: string }} opts
 * @returns {Promise<{ invalidated: boolean, contract: object|null }>}
 */
export async function invalidateImpactContract(db, { taskId, _reason = null, expectedHash = null }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const activeRes = await client.query(
      `SELECT * FROM harness_impact_contracts
       WHERE task_id = $1 AND status = 'active'
       LIMIT 1`,
      [taskId]
    );

    if (activeRes.rows.length === 0) {
      await client.query('COMMIT');
      return { invalidated: false, contract: null };
    }

    const contract = activeRes.rows[0];

    // 若指定了 expectedHash，做乐观锁检查
    if (expectedHash && contract.contract_hash !== expectedHash) {
      await client.query('ROLLBACK');
      const err = new Error('contract_hash_mismatch');
      err.code = 'CONTRACT_HASH_MISMATCH';
      throw err;
    }

    await client.query(
      `UPDATE harness_impact_contracts
       SET status = 'invalidated',
           invalidated_at = NOW()
       WHERE id = $1`,
      [contract.id]
    );

    await client.query('COMMIT');
    return { invalidated: true, contract };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default {
  persistImpactContract,
  getActiveImpactContract,
  getImpactContractById,
  listImpactContracts,
  invalidateImpactContract,
  computeContractHash,
};
