/**
 * Unified Map API — 唯一读写入口
 * PRD: Universal Map Projection Engine, 刀4
 *
 * 写入口：validate / submit / activate / rebuild
 * 读入口：整图 / 节点详情 / 影响半径 / 健康度 / 未归属
 *
 * 不存在 Value Stream、Capability、Boundary、Cross-cut 的独立创建端点。
 * 禁止新消费者自行 JOIN 旧表拼出另一张地图。
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import Ajv from 'ajv';
import { MANIFEST_SCHEMA_V1, validateManifestSemantics } from '../map/manifest-schema.js';
import {
  submitManifestDraft,
  activateManifest,
  getActiveManifest,
  listManifests,
  computeManifestDigest,
} from '../map/manifest-store.js';
import {
  runProjection,
  getActiveProjection,
  getProjectionNodes,
  getProjectionEdges,
} from '../map/projector.js';
import {
  resolveAllNodeStates,
  getFactHealthSummary,
} from '../map/state-resolver.js';
import pool from '../db.js';

const router = Router();

router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

// AJV 实例（JSON Schema 校验）
// allErrors: false — 遇第一个错误即停，防止深度嵌套输入触发 DoS。
const ajv = new Ajv({ allErrors: false, strict: false });
const validateSchema = ajv.compile(MANIFEST_SCHEMA_V1);

/**
 * 构建标准响应 envelope
 */
function buildEnvelope(scopeKey, extra = {}) {
  return {
    scope_key: scopeKey,
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

// ─────────────────────────────────────────────
// 写入口
// ─────────────────────────────────────────────

/**
 * POST /api/brain/map/manifests/validate
 * 纯校验，不写库
 */
router.post('/manifests/validate', async (req, res) => {
  try {
    const manifest = req.body;
    const schemaValid = validateSchema(manifest);
    if (!schemaValid) {
      return res.status(400).json({
        valid: false,
        errors: validateSchema.errors.map((e) => `${e.instancePath} ${e.message}`),
      });
    }
    const semantic = validateManifestSemantics(manifest);
    if (!semantic.valid) {
      return res.status(400).json({ valid: false, errors: semantic.errors });
    }
    const digest = computeManifestDigest(manifest);
    res.json({ valid: true, errors: [], digest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/map/manifests
 * 提交完整 manifest draft，要求 source_decision_id
 */
router.post('/manifests', async (req, res) => {
  try {
    const { manifest, source_decision_id } = req.body;
    if (!manifest) return res.status(400).json({ error: 'manifest 必填' });

    const schemaValid = validateSchema(manifest);
    if (!schemaValid) {
      return res.status(400).json({
        error: 'manifest schema 校验失败',
        errors: validateSchema.errors.map((e) => `${e.instancePath} ${e.message}`),
      });
    }

    const semantic = validateManifestSemantics(manifest);
    if (!semantic.valid) {
      return res.status(400).json({ error: 'manifest 语义校验失败', errors: semantic.errors });
    }

    const result = await submitManifestDraft({
      scopeKey: manifest.scope_key,
      manifest,
      sourceDecisionId: source_decision_id || manifest.source_decision_id,
    });

    res.status(result.isNew ? 201 : 200).json({
      ...buildEnvelope(manifest.scope_key),
      manifest_id: result.id,
      version: result.version,
      digest: result.digest,
      status: result.status,
      is_new: result.isNew,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/map/manifests/:id/activate
 * 原子激活并触发 projector
 */
router.post('/manifests/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const { scope_key } = req.body;
    if (!scope_key) return res.status(400).json({ error: 'scope_key 必填' });

    const activated = await activateManifest({ manifestId: id, scopeKey: scope_key });

    // 获取 manifest 内容并运行投影器
    const activeManifest = await getActiveManifest(scope_key);
    if (!activeManifest) throw new Error('激活后找不到 active manifest，内部错误');

    const projResult = await runProjection({
      manifestId: activeManifest.id,
      manifestDigest: activeManifest.digest,
      scopeKey: scope_key,
      manifest: activeManifest.manifest,
    });

    res.json({
      ...buildEnvelope(scope_key),
      manifest_id: activated.id,
      manifest_version: activated.version,
      manifest_digest: activated.digest,
      status: activated.status,
      activated_at: activated.activated_at,
      projection: projResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/map/rebuild
 * 基于当前 active manifest 与最新 facts 幂等重建
 */
router.post('/rebuild', async (req, res) => {
  try {
    const { scope_key } = req.body;
    if (!scope_key) return res.status(400).json({ error: 'scope_key 必填' });

    const activeManifest = await getActiveManifest(scope_key);
    if (!activeManifest) {
      return res.status(404).json({ error: `scope '${scope_key}' 没有 active manifest` });
    }

    const projResult = await runProjection({
      manifestId: activeManifest.id,
      manifestDigest: activeManifest.digest,
      scopeKey: scope_key,
      manifest: activeManifest.manifest,
    });

    res.json({
      ...buildEnvelope(scope_key),
      manifest_version: activeManifest.version,
      manifest_digest: activeManifest.digest,
      projection: projResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// 读入口
// ─────────────────────────────────────────────

/**
 * GET /api/brain/map?scope=cecelia
 * 整张图、现算状态、source revisions、freshness、digest
 */
router.get('/', async (req, res) => {
  try {
    const scopeKey = req.query.scope;
    if (!scopeKey) return res.status(400).json({ error: 'scope 参数必填' });

    const [activeManifest, activeProjection] = await Promise.all([
      getActiveManifest(scopeKey),
      getActiveProjection(scopeKey),
    ]);

    if (!activeManifest) {
      return res.status(404).json({ error: `scope '${scopeKey}' 没有 active manifest` });
    }

    const [nodes, edges] = await Promise.all([
      getProjectionNodes(scopeKey),
      getProjectionEdges(scopeKey),
    ]);

    // 现算状态
    const stateMap = await resolveAllNodeStates(scopeKey, nodes);

    // 事实源健康
    const factHealth = await getFactHealthSummary(scopeKey, scopeKey);

    const nodesWithState = nodes.map((n) => ({
      key: n.node_key,
      type: n.node_type,
      name: n.name,
      aliases: n.aliases,
      attributes: n.attributes,
      display_order: n.display_order,
      state: stateMap.get(n.node_key)?.state || 'unknown',
      state_reason: stateMap.get(n.node_key)?.reason_code || null,
    }));

    res.json({
      ...buildEnvelope(scopeKey),
      manifest_version: activeManifest.version,
      manifest_digest: activeManifest.digest,
      projection_digest: activeProjection?.projection_digest || null,
      fact_revisions: activeProjection?.fact_revisions || {},
      freshness: factHealth,
      nodes: nodesWithState,
      edges: edges.map((e) => ({
        key: e.edge_key,
        from: e.from_key,
        to: e.to_key,
        type: e.edge_type,
        attributes: e.attributes,
      })),
      summary: {
        value_streams: nodesWithState.filter((n) => n.type === 'value_stream').length,
        capabilities: nodesWithState.filter((n) => n.type === 'capability').length,
        crosscuts: nodesWithState.filter((n) => n.type === 'crosscut').length,
        prerequisites: nodesWithState.filter((n) => n.type === 'prerequisite').length,
        boundaries: edges.filter((e) => e.edge_type === 'hands_off_to').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/map/nodes/:key?scope=...
 * 节点详情、上下游、锚点、证据、受影响范围
 */
router.get('/nodes/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const scopeKey = req.query.scope;
    if (!scopeKey) return res.status(400).json({ error: 'scope 参数必填' });

    const projection = await getActiveProjection(scopeKey);
    if (!projection) return res.status(404).json({ error: '无 active projection' });

    const { rows: nodeRows } = await pool.query(
      `SELECT n.* FROM map_projection_nodes n
       WHERE n.run_id = $1 AND (n.node_key = $2 OR $2 = ANY(n.aliases))`,
      [projection.id, key]
    );
    if (nodeRows.length === 0) return res.status(404).json({ error: `节点不存在: ${key}` });
    const node = nodeRows[0];

    // 上游边（to_key = 当前节点）
    const { rows: inEdges } = await pool.query(
      `SELECT * FROM map_projection_edges WHERE run_id = $1 AND to_key = $2`,
      [projection.id, node.node_key]
    );
    // 下游边（from_key = 当前节点）
    const { rows: outEdges } = await pool.query(
      `SELECT * FROM map_projection_edges WHERE run_id = $1 AND from_key = $2`,
      [projection.id, node.node_key]
    );

    // 边界声明（如果节点是 capability）
    const boundaries = [
      ...inEdges.filter((e) => e.edge_type === 'hands_off_to'),
      ...outEdges.filter((e) => e.edge_type === 'hands_off_to'),
    ];

    // 现算状态
    const stateInfo = await import('../map/state-resolver.js').then((m) =>
      m.resolveNodeState(node.node_key, { repo: scopeKey })
    );

    res.json({
      ...buildEnvelope(scopeKey),
      node: {
        key: node.node_key,
        type: node.node_type,
        name: node.name,
        aliases: node.aliases,
        attributes: node.attributes,
        source_refs: node.source_refs,
        display_order: node.display_order,
      },
      state: stateInfo.state,
      state_reason: stateInfo.reason_code,
      state_details: stateInfo.details,
      upstream: inEdges.map((e) => ({ from: e.from_key, to: e.to_key, type: e.edge_type, attributes: e.attributes })),
      downstream: outEdges.map((e) => ({ from: e.from_key, to: e.to_key, type: e.edge_type, attributes: e.attributes })),
      boundaries: boundaries.map((e) => ({
        from: e.from_key, to: e.to_key, statement: e.attributes?.statement,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/map/radius
 * 输入 repo + changed files，返回受影响业务节点与必跑断言
 */
router.post('/radius', async (req, res) => {
  try {
    const { scope, repo, changed_files } = req.body;
    if (!scope || !changed_files?.length) {
      return res.status(400).json({ error: 'scope 和 changed_files 必填' });
    }

    const projection = await getActiveProjection(scope);
    if (!projection) return res.status(404).json({ error: '无 active projection' });

    // 从 graph_edges 找出受影响的文件
    const { rows: affectedEdges } = await pool.query(
      `SELECT DISTINCT src_path, dst_path FROM graph_edges
       WHERE repo = $1 AND (src_path = ANY($2) OR dst_path = ANY($2))`,
      [repo || scope, changed_files]
    );

    const affectedPaths = new Set([
      ...affectedEdges.map((e) => e.src_path),
      ...affectedEdges.map((e) => e.dst_path),
      ...changed_files,
    ]);

    // 找出 API 匹配
    const { rows: apiMatches } = await pool.query(
      `SELECT method, path, area FROM api_registry
       WHERE repo = $1 AND file_path = ANY($2)`,
      [repo || scope, Array.from(affectedPaths)]
    );

    // 找出测试匹配
    const { rows: testMatches } = await pool.query(
      `SELECT file_path, area, test_type FROM test_registry
       WHERE repo = $1 AND file_path = ANY($2)`,
      [repo || scope, Array.from(affectedPaths)]
    );

    // 找出相关 capabilities（通过 source_refs 或 node_key）
    const { rows: affectedNodes } = await pool.query(
      `SELECT node_key, node_type, name FROM map_projection_nodes
       WHERE run_id = $1`,
      [projection.id]
    );

    // 简单匹配：changed file 路径包含 node key（粗粒度）
    const matchedNodes = affectedNodes.filter((n) =>
      Array.from(affectedPaths).some((p) => p.toLowerCase().includes(n.node_key.toLowerCase()))
    );

    res.json({
      ...buildEnvelope(scope),
      changed_files,
      affected_paths: Array.from(affectedPaths),
      affected_nodes: matchedNodes.map((n) => ({
        key: n.node_key, type: n.node_type, name: n.name,
      })),
      affected_apis: apiMatches,
      must_run_tests: testMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/map/health?scope=...
 * manifest、facts、projection、state resolver 四层健康度
 */
router.get('/health', async (req, res) => {
  try {
    const scopeKey = req.query.scope;
    if (!scopeKey) return res.status(400).json({ error: 'scope 参数必填' });

    const [activeManifest, activeProjection, factHealth] = await Promise.all([
      getActiveManifest(scopeKey),
      getActiveProjection(scopeKey),
      getFactHealthSummary(scopeKey, scopeKey),
    ]);

    const manifestHealth = activeManifest ? 'ok' : 'missing';
    const projectionHealth = activeProjection?.status === 'active' ? 'ok' : (activeProjection ? activeProjection.status : 'missing');

    res.json({
      ...buildEnvelope(scopeKey),
      layers: {
        manifest: {
          status: manifestHealth,
          version: activeManifest?.version || null,
          digest: activeManifest?.digest || null,
          activated_at: activeManifest?.activated_at || null,
        },
        facts: {
          status: factHealth.overall,
          detail: factHealth,
        },
        projection: {
          status: projectionHealth,
          run_id: activeProjection?.id || null,
          projection_digest: activeProjection?.projection_digest || null,
          activated_at: activeProjection?.activated_at || null,
        },
        state_resolver: {
          status: (activeProjection && activeManifest) ? 'ok' : 'degraded',
        },
      },
      overall: (manifestHealth === 'ok' && projectionHealth === 'ok') ? 'healthy' : 'degraded',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/map/unclaimed?scope=...
 * 图中有实现事实但尚无业务归属的 artifacts
 */
router.get('/unclaimed', async (req, res) => {
  try {
    const scopeKey = req.query.scope;
    if (!scopeKey) return res.status(400).json({ error: 'scope 参数必填' });

    const projection = await getActiveProjection(scopeKey);
    const claimedKeys = new Set();
    if (projection) {
      const { rows } = await pool.query(
        `SELECT node_key FROM map_projection_nodes WHERE run_id = $1`,
        [projection.id]
      );
      rows.forEach((r) => claimedKeys.add(r.node_key));
    }

    // 找出有代码图边但未归属的文件
    const { rows: edges } = await pool.query(
      `SELECT DISTINCT src_path AS path FROM graph_edges WHERE repo = $1
       UNION SELECT DISTINCT dst_path AS path FROM graph_edges WHERE repo = $1
       LIMIT 200`,
      [scopeKey]
    );

    const unclaimed = edges.filter((e) => !claimedKeys.has(e.path));

    res.json({
      ...buildEnvelope(scopeKey),
      unclaimed_count: unclaimed.length,
      unclaimed: unclaimed.slice(0, 100).map((e) => ({ path: e.path })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/map/manifests?scope=...
 * 列出 manifest 历史版本
 */
router.get('/manifests', async (req, res) => {
  try {
    const scopeKey = req.query.scope;
    if (!scopeKey) return res.status(400).json({ error: 'scope 参数必填' });
    const manifests = await listManifests(scopeKey);
    res.json({ ...buildEnvelope(scopeKey), manifests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
