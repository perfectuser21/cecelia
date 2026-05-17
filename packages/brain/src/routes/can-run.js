/**
 * Brain API: Resource Scheduling — can-run
 *
 * POST /api/brain/can-run
 * Body: { resource_type: 'notebooklm'|'llm'|'image-gen', size?: number }
 * Response: { approved: bool, reason: string, retry_after?: number }
 *
 * v1: 简单实现，合法 resource_type 一律 approved=true。
 * v2（未来）: 配额/节拍/并发控制。
 */

import { Router } from 'express';

const router = Router();

const VALID_RESOURCE_TYPES = new Set(['notebooklm', 'llm', 'image-gen']);

/**
 * POST /can-run
 */
router.post('/can-run', (req, res) => {
  try {
    const { resource_type, size } = req.body || {};

    if (!resource_type || typeof resource_type !== 'string') {
      return res.status(400).json({
        approved: false,
        reason: 'resource_type 必填且须为字符串',
      });
    }

    if (!VALID_RESOURCE_TYPES.has(resource_type)) {
      return res.status(400).json({
        approved: false,
        reason: `未知 resource_type: ${resource_type}（允许: ${[...VALID_RESOURCE_TYPES].join(', ')})`,
      });
    }

    if (size !== undefined && (typeof size !== 'number' || size < 1)) {
      return res.status(400).json({
        approved: false,
        reason: 'size 须为正整数',
      });
    }

    // v1: 一律批准
    return res.json({
      approved: true,
      reason: 'v1 always approved',
    });
  } catch (err) {
    console.error('[can-run] 内部错误:', err.message);
    return res.status(500).json({
      approved: false,
      reason: `内部错误: ${err.message}`,
    });
  }
});

export default router;
