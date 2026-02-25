/**
 * trace-routes.js - Trace observability API endpoints
 *
 * Provides HTTP API for querying run_events and run_artifacts tables.
 *
 * Endpoints:
 * - GET /api/brain/trace/runs/active - Active runs
 * - GET /api/brain/trace/runs/:run_id - Run summary
 * - GET /api/brain/trace/runs/:run_id/last-alive - Last alive span
 * - GET /api/brain/trace/failures/top - Top failure reasons (24h)
 * - GET /api/brain/trace/stuck - Stuck runs (no heartbeat 5+ min)
 * - GET /api/brain/trace/artifacts/:id - Artifact metadata
 * - GET /api/brain/trace/artifacts/:id/download - Artifact proxy (download file)
 */

import { Router } from 'express';
import {
  getActiveRuns,
  getRunSummary,
  getLastAliveSpan,
  getTopFailureReasons,
  getStuckRuns,
  getArtifact,
} from './trace.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

/**
 * GET /api/brain/trace/runs/active
 * Get all active runs (currently running)
 */
router.get('/runs/active', async (req, res) => {
  try {
    const activeRuns = await getActiveRuns();
    res.json({
      success: true,
      data: activeRuns,
      count: activeRuns.length,
    });
  } catch (error) {
    console.error('[Trace API] Error getting active runs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/runs/:run_id
 * Get run summary by run_id
 */
router.get('/runs/:run_id', async (req, res) => {
  try {
    const { run_id } = req.params;
    const summary = await getRunSummary(run_id);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Run not found',
      });
    }

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[Trace API] Error getting run summary:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/runs/:run_id/last-alive
 * Get last alive span for a run (for stuck detection)
 */
router.get('/runs/:run_id/last-alive', async (req, res) => {
  try {
    const { run_id } = req.params;
    const lastAlive = await getLastAliveSpan(run_id);

    if (!lastAlive) {
      return res.status(404).json({
        success: false,
        error: 'Run not found',
      });
    }

    res.json({
      success: true,
      data: lastAlive,
    });
  } catch (error) {
    console.error('[Trace API] Error getting last alive span:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/failures/top
 * Get top failure reasons (last 24h)
 */
router.get('/failures/top', async (req, res) => {
  try {
    const topFailures = await getTopFailureReasons();
    res.json({
      success: true,
      data: topFailures,
      count: topFailures.length,
    });
  } catch (error) {
    console.error('[Trace API] Error getting top failures:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/stuck
 * Get stuck runs (no heartbeat for 5+ minutes)
 */
router.get('/stuck', async (req, res) => {
  try {
    const stuckRuns = await getStuckRuns();
    res.json({
      success: true,
      data: stuckRuns,
      count: stuckRuns.length,
    });
  } catch (error) {
    console.error('[Trace API] Error getting stuck runs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/artifacts/:id
 * Get artifact metadata by ID
 */
router.get('/artifacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const artifact = await getArtifact(id);

    if (!artifact) {
      return res.status(404).json({
        success: false,
        error: 'Artifact not found',
      });
    }

    res.json({
      success: true,
      data: artifact,
    });
  } catch (error) {
    console.error('[Trace API] Error getting artifact:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/brain/trace/artifacts/:id/download
 * Download artifact file (proxy pattern)
 *
 * Supports storage backends:
 * - local: Read from file path
 * - s3: TODO: Proxy from S3
 * - nas: TODO: Proxy from NAS
 */
router.get('/artifacts/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const artifact = await getArtifact(id);

    if (!artifact) {
      return res.status(404).json({
        success: false,
        error: 'Artifact not found',
      });
    }

    // Handle different storage backends
    if (artifact.storage_backend === 'local') {
      // Read from local file
      const filePath = artifact.storage_key;

      // Security: Prevent path traversal
      if (filePath.includes('..')) {
        return res.status(403).json({
          success: false,
          error: 'Invalid file path',
        });
      }

      try {
        const fileBuffer = await fs.readFile(filePath);

        // Set content type
        if (artifact.content_type) {
          res.setHeader('Content-Type', artifact.content_type);
        }

        // Set content disposition (download)
        const filename = path.basename(filePath);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        res.send(fileBuffer);
      } catch (readError) {
        if (readError.code === 'ENOENT') {
          return res.status(404).json({
            success: false,
            error: 'Artifact file not found on disk',
          });
        }
        throw readError;
      }
    } else if (artifact.storage_backend === 's3') {
      // TODO: Implement S3 proxy
      res.status(501).json({
        success: false,
        error: 'S3 backend not implemented yet',
      });
    } else if (artifact.storage_backend === 'nas') {
      // TODO: Implement NAS proxy
      res.status(501).json({
        success: false,
        error: 'NAS backend not implemented yet',
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Unknown storage backend: ${artifact.storage_backend}`,
      });
    }
  } catch (error) {
    console.error('[Trace API] Error downloading artifact:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
