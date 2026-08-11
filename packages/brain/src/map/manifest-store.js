/**
 * Manifest Store — 版本化 manifest 的 DB 操作层
 * PRD: Universal Map Projection Engine, 刀1
 *
 * 写入规则：
 * - 重复 digest → 幂等，不创建新 version
 * - 激活与 source_decision 绑定在同一事务
 * - 同一 scope_key 最多一份 active manifest（DB 唯一索引保障）
 */

import crypto from 'crypto';
import pool from '../db.js';

/** 计算 manifest 的 canonical SHA-256 digest */
export function computeManifestDigest(manifest) {
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * 获取 scope_key 下的下一个版本号
 */
async function nextVersion(client, scopeKey) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_ver
     FROM map_manifest_versions
     WHERE scope_key = $1`,
    [scopeKey]
  );
  return rows[0].next_ver;
}

/**
 * 提交 manifest draft（幂等：相同 digest 返回现有记录）
 * @param {{ scopeKey, manifest, sourceDecisionId? }} opts
 * @returns {{ id, version, digest, status, isNew }}
 */
export async function submitManifestDraft({ scopeKey, manifest, sourceDecisionId }) {
  const digest = computeManifestDigest(manifest);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 幂等：已存在相同 digest
    const existing = await client.query(
      `SELECT id, version, digest, status FROM map_manifest_versions WHERE digest = $1`,
      [digest]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ...existing.rows[0], isNew: false };
    }

    const version = await nextVersion(client, scopeKey);
    const { rows } = await client.query(
      `INSERT INTO map_manifest_versions
         (scope_key, version, source_decision_id, manifest, digest, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id, version, digest, status`,
      [scopeKey, version, sourceDecisionId || null, JSON.stringify(manifest), digest]
    );

    await client.query('COMMIT');
    return { ...rows[0], isNew: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 激活 manifest（原子：旧 active → superseded，新记录 → active）
 * @param {{ manifestId, scopeKey }} opts
 * @returns {{ id, version, scope_key, digest, status }}
 */
export async function activateManifest({ manifestId, scopeKey }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 获取要激活的 manifest
    const { rows: target } = await client.query(
      `SELECT id, scope_key, version, digest, status, source_decision_id
       FROM map_manifest_versions WHERE id = $1`,
      [manifestId]
    );
    if (target.length === 0) throw new Error(`manifest 不存在: ${manifestId}`);
    const m = target[0];
    if (m.scope_key !== scopeKey) throw new Error(`scope_key 不匹配: ${m.scope_key} vs ${scopeKey}`);
    if (m.status === 'active') return m; // 已经是 active，幂等

    // 旧 active → superseded
    await client.query(
      `UPDATE map_manifest_versions SET status = 'superseded'
       WHERE scope_key = $1 AND status = 'active'`,
      [scopeKey]
    );

    // 激活
    const { rows } = await client.query(
      `UPDATE map_manifest_versions
       SET status = 'active', activated_at = NOW()
       WHERE id = $1
       RETURNING id, scope_key, version, digest, status, activated_at`,
      [manifestId]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 获取 scope_key 的当前 active manifest
 */
export async function getActiveManifest(scopeKey) {
  const { rows } = await pool.query(
    `SELECT id, scope_key, version, manifest, digest, status, source_decision_id, activated_at, created_at
     FROM map_manifest_versions
     WHERE scope_key = $1 AND status = 'active'
     LIMIT 1`,
    [scopeKey]
  );
  return rows[0] || null;
}

/**
 * 列出 scope_key 下的所有 manifest 版本
 */
export async function listManifests(scopeKey) {
  const { rows } = await pool.query(
    `SELECT id, scope_key, version, digest, status, source_decision_id, activated_at, created_at
     FROM map_manifest_versions
     WHERE scope_key = $1
     ORDER BY version DESC`,
    [scopeKey]
  );
  return rows;
}
