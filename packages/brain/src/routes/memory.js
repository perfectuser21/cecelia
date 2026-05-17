/**
 * Memory API Routes
 *
 * 递进式历史记忆搜索 API:
 * - POST /api/brain/memory/search - 概要搜索
 * - GET /api/brain/memory/detail/:id - 查看详情
 * - POST /api/brain/memory/search-related - 搜索相关
 */

import { Router } from 'express';
import MemoryService from '../services/memory-service.js';
import pool from '../db.js';

const router = Router();
const memoryService = new MemoryService(pool);

/**
 * POST /api/brain/memory/search
 *
 * 搜索相关历史（Summary 层）
 *
 * Request body:
 * {
 *   "query": "用户登录验证",
 *   "topK": 5,
 *   "mode": "summary"
 * }
 *
 * Response:
 * {
 *   "matches": [
 *     {
 *       "id": "abc-123",
 *       "level": "task",
 *       "title": "feat(auth): cross-subdomain cookie auth",
 *       "similarity": 0.32,
 *       "preview": "用 cookie 替代 localStorage..."
 *     }
 *   ]
 * }
 */
router.post('/search', async (req, res) => {
  try {
    const { query, topK, mode } = req.body;

    // 验证必填参数
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'query is required and must be a string'
      });
    }

    // 调用 Memory Service
    const results = await memoryService.search(query, { topK, mode });

    res.json(results);
  } catch (error) {
    console.error('[Memory API] Search error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/brain/memory/detail/:id
 *
 * 查看完整详情（Detail 层）
 *
 * Response:
 * {
 *   "id": "abc-123",
 *   "level": "task",
 *   "title": "feat(auth): cross-subdomain cookie auth",
 *   "description": "完整描述...",
 *   "status": "completed",
 *   "metadata": {...},
 *   "created_at": "2024-01-15"
 * }
 */
router.get('/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 验证 ID 格式（UUID）
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'id must be a valid UUID'
      });
    }

    // 调用 Memory Service
    const detail = await memoryService.getDetail(id);

    res.json(detail);
  } catch (error) {
    // Entity not found
    if (error.message.startsWith('Entity not found')) {
      return res.status(404).json({
        error: 'Not found',
        message: error.message
      });
    }

    console.error('[Memory API] Get detail error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/brain/memory/search-related
 *
 * 搜索相关任务（Related 层）
 *
 * Request body:
 * {
 *   "base_id": "abc-123",
 *   "topK": 5,
 *   "exclude_self": true
 * }
 *
 * Response: 同 /search 格式
 */
router.post('/search-related', async (req, res) => {
  try {
    const { base_id, topK, exclude_self } = req.body;

    // 验证必填参数
    if (!base_id || typeof base_id !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'base_id is required and must be a string'
      });
    }

    // 验证 ID 格式（UUID）
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(base_id)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'base_id must be a valid UUID'
      });
    }

    // 调用 Memory Service
    const results = await memoryService.searchRelated(base_id, {
      topK,
      excludeSelf: exclude_self !== false // 默认 true
    });

    res.json(results);
  } catch (error) {
    // Entity not found
    if (error.message.startsWith('Entity not found')) {
      return res.status(404).json({
        error: 'Not found',
        message: error.message
      });
    }

    console.error('[Memory API] Search related error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;
