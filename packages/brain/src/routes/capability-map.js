/**
 * 能力地图 API 路由
 * 提供扫描结果和能力状态查询接口
 */

import { Router } from 'express';
import { scanCapabilities, getCapabilityHealth } from '../capability-scanner.js';

const router = Router();

/**
 * GET /api/brain/capabilities
 * 获取完整的能力地图
 */
router.get('/capabilities', async (req, res) => {
  try {
    const scanResult = await scanCapabilities();

    const capabilityMap = {
      timestamp: new Date().toISOString(),
      summary: scanResult.summary,
      embedded_capabilities: scanResult.capabilities
        .filter(cap => cap.evidence.some(ev => ev.includes('brain_embedded:true')))
        .map(cap => ({
          id: cap.id,
          name: cap.name,
          status: cap.status,
          evidence: cap.evidence
        })),
      isolated_capabilities: scanResult.capabilities
        .filter(cap => cap.status === 'island')
        .map(cap => ({
          id: cap.id,
          name: cap.name,
          stage: cap.stage,
          scope: cap.scope,
          status: cap.status
        })),
      all_capabilities: scanResult.capabilities.map(cap => ({
        id: cap.id,
        name: cap.name,
        status: cap.status,
        stage: cap.stage,
        last_activity: cap.last_activity,
        usage_30d: cap.usage_30d
      }))
    };

    res.json(capabilityMap);

  } catch (error) {
    console.error('[Capability Map API] Error:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/brain/capabilities/scan
 * 获取最新的扫描结果（缓存）
 */
router.get('/capabilities/scan', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1;
    const results = await getCapabilityHealth(limit);
    res.json(results);
  } catch (error) {
    console.error('[Capability Scan API] Error:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/brain/capabilities/rescan
 * 强制重新扫描所有能力
 */
router.post('/capabilities/rescan', async (req, res) => {
  try {
    const scanResult = await scanCapabilities();

    // 将结果保存到 cecelia_events
    const pool = (await import('../db.js')).default;
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('capability_scan', 'api-rescan', $1)`,
      [JSON.stringify(scanResult)]
    );

    res.json({
      success: true,
      scan_result: scanResult,
      message: 'Capability scan completed and cached'
    });

  } catch (error) {
    console.error('[Capability Rescan API] Error:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;