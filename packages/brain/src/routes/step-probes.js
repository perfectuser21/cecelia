/**
 * step-probes.js — 步级探针注册表端点（链 bf5088a3 棒2，决策 702949b6）。
 *
 * GET  /api/brain/step-probes?workflow=&stage=&active=all   只读列表（默认只出 active）
 * POST /api/brain/step-probes                                按 probe_key upsert（内部鉴权）
 *      body: { workflow, source_path?, source_sha256?, probes: [ <YAML 一条> + journey_step_link_id? ] }
 *      每条经 normalizeProbe 归一化 → spec_hash = sha256(canonical JSON)；哈希一致 → action=unchanged
 *      source_sha256 = 整文件原文 sha256（同 workspace probes-lib loadChecks().sha256），与逐条 spec_hash 两级并存
 * POST /api/brain/step-probes/drift-check                    漂移比对（内部鉴权）
 *      body: { workflow, source_sha256?, probes: [{ key, spec_hash }] }
 *        → { drift, missing, extra, changed, same, source_match, registered_source_sha256 }
 *
 * 仓库 YAML 是 SSOT；这里只是投影，写入方是 scripts/sync-step-probes.mjs（流水线副作用写，决策 df1ccf5a）。
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import {
  compareProbeHashes, isSpecHash, normalizeProbe, specHash, stepProbeError,
} from '../lib/step-probe-spec.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = `id, probe_key, workflow, stage, journey_step_link_id, spec, spec_hash,
       source_path, source_sha256, severity, active, created_at, updated_at`;

router.get('/step-probes', async (req, res) => {
  try {
    const params = [];
    const clauses = [];
    if (req.query.workflow) { params.push(String(req.query.workflow)); clauses.push(`workflow = $${params.length}`); }
    if (req.query.stage) { params.push(String(req.query.stage)); clauses.push(`stage = $${params.length}`); }
    if (req.query.active !== 'all') clauses.push('active = true');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM step_probes ${where} ORDER BY workflow, stage, probe_key`,
      params,
    );
    res.json({ probes: rows, count: rows.length });
  } catch (err) {
    console.error('[step-probes] GET /step-probes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** 请求体 → [{ spec, spec_hash, journey_step_link_id }]；任一条非法即整批拒收。 */
function prepareUpserts(body) {
  const { workflow, probes } = body || {};
  if (!Array.isArray(probes) || probes.length === 0) {
    throw stepProbeError('STEP_PROBE_DOC_INVALID', 'probes 必须是非空数组');
  }
  return probes.map((raw) => {
    const { journey_step_link_id: linkId, ...rest } = raw || {};
    const spec = normalizeProbe(rest, { workflow });
    if (linkId !== undefined && linkId !== null && !UUID_RE.test(String(linkId))) {
      throw stepProbeError('STEP_PROBE_LINK_INVALID', `探针 ${spec.key}: journey_step_link_id 必须是 uuid`, { probe_key: spec.key });
    }
    return { spec, spec_hash: specHash(spec), journey_step_link_id: linkId ?? null };
  });
}

router.post('/step-probes', internalAuthOrLoopback, async (req, res) => {
  let items;
  try {
    items = prepareUpserts(req.body);
  } catch (err) {
    if (!err.code) throw err;
    return res.status(400).json({ error: { code: err.code, message: err.message, probe_key: err.probe_key ?? null } });
  }
  const sourcePath = typeof req.body.source_path === 'string' ? req.body.source_path : null;
  const sourceSha = req.body.source_sha256 ?? null;
  if (sourceSha !== null && !isSpecHash(sourceSha)) {
    return res.status(400).json({ error: { code: 'STEP_PROBE_SOURCE_SHA_INVALID', message: 'source_sha256 必须是 hex64（整文件 sha256）', probe_key: null } });
  }
  try {
    const keys = items.map((it) => it.spec.key);
    const { rows: existing } = await pool.query(
      'SELECT probe_key, spec_hash FROM step_probes WHERE probe_key = ANY($1)', [keys],
    );
    const before = new Map(existing.map((r) => [r.probe_key, r.spec_hash]));
    const upserted = [];
    for (const it of items) {
      const { rows } = await pool.query(
        `INSERT INTO step_probes
           (probe_key, workflow, stage, journey_step_link_id, spec, spec_hash, source_path, severity, active, source_sha256)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, true, $9)
         ON CONFLICT (probe_key) DO UPDATE SET
           workflow = EXCLUDED.workflow,
           stage = EXCLUDED.stage,
           journey_step_link_id = COALESCE(EXCLUDED.journey_step_link_id, step_probes.journey_step_link_id),
           spec = EXCLUDED.spec,
           spec_hash = EXCLUDED.spec_hash,
           source_path = COALESCE(EXCLUDED.source_path, step_probes.source_path),
           source_sha256 = COALESCE(EXCLUDED.source_sha256, step_probes.source_sha256),
           severity = EXCLUDED.severity,
           active = true,
           updated_at = now()
         RETURNING ${COLUMNS}`,
        [it.spec.key, it.spec.workflow, it.spec.stage, it.journey_step_link_id,
          JSON.stringify(it.spec), it.spec_hash, sourcePath, it.spec.severity, sourceSha],
      );
      const row = rows[0];
      const prior = before.get(it.spec.key);
      const action = prior === undefined ? 'inserted' : prior === it.spec_hash ? 'unchanged' : 'updated';
      upserted.push({ probe_key: it.spec.key, id: row?.id ?? null, spec_hash: it.spec_hash,
        journey_step_link_id: row?.journey_step_link_id ?? it.journey_step_link_id, action });
    }
    res.json({ upserted, count: upserted.length });
  } catch (err) {
    console.error('[step-probes] POST /step-probes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/step-probes/drift-check', internalAuthOrLoopback, async (req, res) => {
  const { workflow, probes, source_sha256: sourceSha = null } = req.body || {};
  const shapeOk = typeof workflow === 'string' && workflow.trim() && Array.isArray(probes)
    && probes.every((p) => p && typeof p.key === 'string' && isSpecHash(p.spec_hash))
    && (sourceSha === null || isSpecHash(sourceSha));
  if (!shapeOk) {
    return res.status(400).json({ error: { code: 'STEP_PROBE_DOC_INVALID', message: 'workflow 与 probes[{key, spec_hash(hex64)}] 必填；source_sha256 可选须 hex64' } });
  }
  try {
    const { rows } = await pool.query(
      'SELECT probe_key, spec_hash, active, source_sha256 FROM step_probes WHERE workflow = $1', [workflow.trim()],
    );
    const compared = compareProbeHashes(rows, probes);
    // 文件级：库里该 workflow 所有 active 行登记的 source_sha256 去重；恰好一个且等于现算 = 同一版；多版并存 = 半同步
    const registered = [...new Set(rows.filter((r) => r.active !== false && r.source_sha256).map((r) => r.source_sha256))].sort();
    const sourceMatch = sourceSha === null ? null : registered.length === 1 && registered[0] === sourceSha;
    res.json({
      workflow: workflow.trim(), ...compared,
      drift: compared.drift || sourceMatch === false,
      source_match: sourceMatch, registered_source_sha256: registered,
    });
  } catch (err) {
    console.error('[step-probes] POST /step-probes/drift-check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
