/**
 * routes/impact-contracts.js — Impact Contract API 路由（FR-2）
 *
 * POST /api/brain/tasks/:taskId/impact-contract
 *   创建或更新合同（幂等：同 hash 返回 200 + 已有 id）
 *   成功创建：201 + { id, task_id, version, status, ... }
 *   schema 非法：400 + { error, fields }
 *   幂等返回：200 + { id, task_id, ... }
 *
 * GET /api/brain/tasks/:taskId/impact-contract
 *   获取当前 active 合同
 *   存在：200 + 合同 JSON
 *   不存在：404
 *
 * GET /api/brain/impact-contracts/:contractId
 *   按 id 获取特定合同
 *
 * POST /api/brain/impact-contracts
 *   直接创建合同（body 中包含 task_id）
 *   注：此路径供向后兼容，推荐使用 tasks/:taskId/impact-contract
 *
 * sprint: 08110022-relay-d96c9fa0 ws2
 */

import { Router } from 'express';
import pool from '../db.js';
import { validateImpactContract } from '../impact-contract/contract-schema.js';
import {
  persistImpactContract,
  getActiveImpactContract,
  getImpactContractById,
} from '../impact-contract/contract-store.js';
import { evaluateStructureGate } from '../impact-contract/structure-gate.js';

const router = Router();

// ---------- 工具函数 ----------

/**
 * formatZodErrors(zodError) — 将 ZodError 格式化为用户友好的字段错误列表。
 * Zod 4.x 使用 .issues（不是 .errors）。
 *
 * @param {import('zod').ZodError} zodError
 * @returns {{ path: string, message: string }[]}
 */
function formatZodErrors(zodError) {
  // Zod 4.x: issues; Zod 3.x: errors（兼容两种）
  const issues = zodError.issues ?? zodError.errors ?? [];
  return issues.map((e) => ({
    path: Array.isArray(e.path) ? (e.path.join('.') || '(root)') : '(root)',
    message: e.message,
  }));
}

/**
 * buildContractBody(parsedData) — 从 parsed schema 数据构建合同 body（用于持久化和哈希计算）。
 * 过滤掉不需要存入 contract_body 的顶层字段。
 */
function buildContractBody(parsedData) {
  return parsedData;
}

// ---------- 路由：按 taskId 创建/获取合同 ----------

/**
 * POST /api/brain/tasks/:taskId/impact-contract
 * 创建或更新 Impact Contract（幂等）
 */
router.post('/tasks/:taskId/impact-contract', async (req, res) => {
  try {
    const { taskId } = req.params;
    const body = { ...req.body, task_id: taskId };

    // Schema 验证
    const validation = validateImpactContract(body);
    if (!validation.success) {
      return res.status(400).json({
        error: '非法 Impact Contract：schema 验证失败',
        fields: formatZodErrors(validation.error),
      });
    }

    const parsed = validation.data;
    const contract_body = buildContractBody(parsed);

    const { contract, created } = await persistImpactContract(pool, {
      task_id: taskId,
      change_kind: parsed.change_kind,
      repo: parsed.repo,
      base_revision: parsed.base_revision,
      head_revision: parsed.head_revision,
      manifest_digest: parsed.manifest_digest,
      projection_digest: parsed.projection_digest,
      contract_body,
    });

    return res.status(created ? 201 : 200).json(contract);
  } catch (err) {
    console.error('[impact-contracts] POST /tasks/:taskId/impact-contract error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

/**
 * GET /api/brain/tasks/:taskId/impact-contract
 * 获取当前 active 合同
 */
router.get('/tasks/:taskId/impact-contract', async (req, res) => {
  try {
    const { taskId } = req.params;
    const contract = await getActiveImpactContract(pool, taskId);

    if (!contract) {
      return res.status(404).json({
        error: 'not_found',
        message: `task ${taskId} 没有 active Impact Contract`,
      });
    }

    return res.status(200).json(contract);
  } catch (err) {
    console.error('[impact-contracts] GET /tasks/:taskId/impact-contract error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- 路由：直接创建合同（兼容旧格式） ----------

/**
 * POST /api/brain/impact-contracts
 * 直接创建合同（body 中包含 task_id）
 * 供 contract-dod.md 验收命令行使用
 */
router.post('/impact-contracts', async (req, res) => {
  try {
    const body = req.body;

    // Schema 验证
    const validation = validateImpactContract(body);
    if (!validation.success) {
      return res.status(400).json({
        error: '非法 Impact Contract：schema 验证失败',
        fields: formatZodErrors(validation.error),
      });
    }

    const parsed = validation.data;
    const contract_body = buildContractBody(parsed);

    const { contract, created } = await persistImpactContract(pool, {
      task_id: parsed.task_id,
      change_kind: parsed.change_kind,
      repo: parsed.repo,
      base_revision: parsed.base_revision,
      head_revision: parsed.head_revision,
      manifest_digest: parsed.manifest_digest,
      projection_digest: parsed.projection_digest,
      contract_body,
    });

    return res.status(created ? 201 : 200).json(contract);
  } catch (err) {
    console.error('[impact-contracts] POST /impact-contracts error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

/**
 * POST /api/brain/tasks/:taskId/impact-contract/evaluate
 * 运行 Structure Gate：编码前合同校验（FR-3）
 *
 * 请求 body：合同内容（与 POST impact-contract 相同格式）
 * 成功放行：201 + { gate: 'pass', contract: {...} }
 * Mapper unavailable：503 + { gate: 'blocked', reason: 'mapper_unavailable', retryable: true }
 * Mapper stale：503 + { gate: 'blocked', reason: 'mapper_stale', retryable: true }
 * Revision mismatch：409 + { gate: 'blocked', reason: 'revision_mismatch', retryable: true }
 * change_kind 缺失：400 + { gate: 'blocked', reason: 'change_kind_missing' }
 * Schema 非法：400 + { error, fields }
 */
router.post('/tasks/:taskId/impact-contract/evaluate', async (req, res) => {
  try {
    const { taskId } = req.params;
    const body = { ...req.body, task_id: taskId };

    // Schema 验证
    const validation = validateImpactContract(body);
    if (!validation.success) {
      return res.status(400).json({
        error: '非法 Impact Contract：schema 验证失败',
        fields: formatZodErrors(validation.error),
      });
    }

    const parsed = validation.data;

    // 构造 task 对象（含 change_kind）
    const task = {
      id: taskId,
      change_kind: parsed.change_kind,
    };

    // 构造合同对象（含 contract_body）
    const contractInput = {
      ...parsed,
      task_id: taskId,
      contract_body: buildContractBody(parsed),
    };

    // 运行 Structure Gate
    const result = await evaluateStructureGate({
      db: pool,
      task,
      contract: contractInput,
    });

    return res.status(result.httpStatus).json(
      result.gate === 'pass'
        ? { gate: result.gate, contract: result.contract }
        : { gate: result.gate, reason: result.reason, retryable: result.retryable ?? false }
    );
  } catch (err) {
    console.error('[impact-contracts] POST /tasks/:taskId/impact-contract/evaluate error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

/**
 * GET /api/brain/impact-contracts/:contractId
 * 按 id 获取特定合同
 */
router.get('/impact-contracts/:contractId', async (req, res) => {
  try {
    const { contractId } = req.params;
    const contract = await getImpactContractById(pool, contractId);

    if (!contract) {
      return res.status(404).json({
        error: 'not_found',
        message: `Impact Contract ${contractId} 不存在`,
      });
    }

    return res.status(200).json(contract);
  } catch (err) {
    console.error('[impact-contracts] GET /impact-contracts/:contractId error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

export default router;
