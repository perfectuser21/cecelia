/**
 * Machines 路由
 *
 * 在 system_registry (type=machine) 基础上叠加实时 Tailscale 状态和冲突检测。
 *
 * GET  /api/brain/machines          — 所有机器列表（含在线状态+冲突）
 * GET  /api/brain/machines/:name    — 单台机器详情
 * PATCH /api/brain/machines/:name   — 更新 metadata（部分更新）
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import pool from '../db.js';

const router = Router();

// 宿主机每分钟写入的 Tailscale 状态缓存文件路径（Brain 容器挂载了宿主机目录）
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '../../../../');
const TAILSCALE_CACHE = join(REPO_ROOT, 'tailscale-cache.json');

function getTailscaleStatus() {
  let raw = null;
  // 优先读宿主机缓存文件（Brain 在容器中无法直接调 tailscale CLI）
  try {
    if (existsSync(TAILSCALE_CACHE)) {
      raw = readFileSync(TAILSCALE_CACHE, 'utf8');
    }
  } catch { /* fallthrough */ }

  // 兜底：尝试直接调 tailscale（在宿主机直接跑时有效）
  if (!raw) {
    try {
      raw = execSync('tailscale status --json', { timeout: 5000 }).toString();
    } catch { return {}; }
  }

  try {
    const data = JSON.parse(raw);
    const online = {};
    const peers = data.Peer || {};
    for (const peer of Object.values(peers)) {
      if (peer.TailscaleIPs?.length) {
        const ip = peer.TailscaleIPs[0].split('/')[0];
        online[ip] = { online: peer.Online ?? true, lastSeen: peer.LastSeen };
      }
    }
    const selfIPs = data.Self?.TailscaleIPs || [];
    if (selfIPs.length) {
      const ip = selfIPs[0].split('/')[0];
      online[ip] = { online: true, lastSeen: null };
    }
    return online;
  } catch {
    return {};
  }
}

function computeConflicts(metadata) {
  const conflicts = [];
  const effectiveCountry = metadata.effective_country;
  const services = metadata.services || [];
  const deprecated = metadata.deprecated || [];

  for (const svc of services) {
    if (svc.needs_cn_ip && effectiveCountry !== 'CN') {
      conflicts.push({
        service: svc.name,
        type: 'ip_mismatch',
        message: `服务需要中国 IP，但机器出口是 ${effectiveCountry}`,
        severity: 'error',
      });
    }
  }

  for (const dep of deprecated) {
    conflicts.push({
      service: dep.name,
      type: 'deprecated',
      message: dep.reason || '废弃服务未清理',
      severity: 'warning',
    });
  }

  return conflicts;
}

function enrichMachine(row, tailscaleStatus) {
  const meta = row.metadata || {};
  const tailscaleIp = meta.tailscale_ip;
  const tsInfo = tailscaleStatus[tailscaleIp] || {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    metadata: meta,
    tailscale_online: tsInfo.online ?? false,
    tailscale_last_seen: tsInfo.lastSeen || null,
    conflicts: computeConflicts(meta),
    updated_at: row.updated_at,
  };
}

/**
 * GET /api/brain/machines
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, status, metadata, updated_at
       FROM system_registry
       WHERE type = 'machine'
       ORDER BY
         CASE (metadata->>'effective_country')
           WHEN 'US' THEN 1 WHEN 'HK' THEN 2 ELSE 3 END,
         name`
    );
    const tsStatus = getTailscaleStatus();
    return res.json(rows.map(r => enrichMachine(r, tsStatus)));
  } catch (err) {
    console.error('[machines] list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/machines/:name
 */
router.get('/:name', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, status, metadata, updated_at
       FROM system_registry
       WHERE type = 'machine' AND name = $1`,
      [req.params.name]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const tsStatus = getTailscaleStatus();
    return res.json(enrichMachine(rows[0], tsStatus));
  } catch (err) {
    console.error('[machines] get error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/machines/:name
 * Body: { metadata: { ...partial } }  — 深度合并到现有 metadata
 */
router.patch('/:name', async (req, res) => {
  try {
    const { metadata: patch } = req.body;
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ error: 'Body must include metadata object' });
    }
    const { rows: existing } = await pool.query(
      `SELECT id, metadata FROM system_registry WHERE type = 'machine' AND name = $1`,
      [req.params.name]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    const merged = { ...existing[0].metadata, ...patch };
    const { rows } = await pool.query(
      `UPDATE system_registry
       SET metadata = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, description, status, metadata, updated_at`,
      [JSON.stringify(merged), existing[0].id]
    );
    const tsStatus = getTailscaleStatus();
    return res.json(enrichMachine(rows[0], tsStatus));
  } catch (err) {
    console.error('[machines] patch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
