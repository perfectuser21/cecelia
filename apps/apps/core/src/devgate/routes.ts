/**
 * DevGate API Routes
 * Base path: /api/devgate
 *
 * Receives metrics from engine's nightly push and stores them for dashboard display.
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Data directory for devgate metrics
const DATA_DIR = join(__dirname, '../../data/devgate');

/**
 * DevGate metrics structure (matches engine's devgate-metrics.json format)
 */
interface DevGateMetrics {
  window: {
    since: string;
    until: string;
  };
  summary: {
    total_tests: number;
    p0_count: number;
    p1_count: number;
    rci_coverage: {
      total: number;
      covered: number;
      pct: number;
    };
    manual_tests: number;
  };
  new_rci: Array<{
    file: string;
    function: string;
    reason: string;
  }>;
  details?: unknown;
}

/**
 * Validate Bearer token from Authorization header
 */
function validateToken(req: Request): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  const expectedToken = process.env.DEVGATE_API_TOKEN;

  if (!expectedToken) {
    console.warn('DEVGATE_API_TOKEN not set in environment');
    return false;
  }

  return token === expectedToken;
}

/**
 * Extract YYYY-MM from ISO date string
 */
function extractMonth(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  } catch {
    return null;
  }
}

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Append log entry to _log.ndjson
 */
async function appendLog(month: string): Promise<void> {
  const logPath = join(DATA_DIR, '_log.ndjson');
  const entry = JSON.stringify({
    received_at: new Date().toISOString(),
    month,
    source: 'engine',
  });
  await fs.appendFile(logPath, entry + '\n');
}

/**
 * POST /api/devgate/metrics
 * Receive and store DevGate metrics from engine
 */
router.post('/metrics', async (req: Request, res: Response) => {
  try {
    // Auth check
    if (!validateToken(req)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or missing Bearer token',
      });
    }

    const body = req.body as DevGateMetrics;

    // Validate body structure
    if (!body || !body.window || !body.window.since) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON: missing window.since field',
      });
    }

    // Extract month from window.since
    const month = extractMonth(body.window.since);
    if (!month) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON: window.since is not a valid date',
      });
    }

    // Ensure data directory exists
    await ensureDataDir();

    // Write metrics to YYYY-MM.json (idempotent overwrite)
    const metricsPath = join(DATA_DIR, `${month}.json`);
    await fs.writeFile(metricsPath, JSON.stringify(body, null, 2));

    // Append to log
    await appendLog(month);

    return res.json({
      status: 'ok',
      month,
    });
  } catch (error: unknown) {
    console.error('DevGate metrics POST error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Storage failed: ${message}`,
    });
  }
});

/**
 * GET /api/devgate/metrics
 * Retrieve DevGate metrics for a given month
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    // Default to current month
    let month = req.query.month as string;
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid month format. Use YYYY-MM.',
      });
    }

    const metricsPath = join(DATA_DIR, `${month}.json`);

    try {
      const content = await fs.readFile(metricsPath, 'utf-8');
      const data = JSON.parse(content);
      return res.json({
        data,
        month,
      });
    } catch (err: unknown) {
      // File doesn't exist
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.json({
          data: null,
          month,
        });
      }
      throw err;
    }
  } catch (error: unknown) {
    console.error('DevGate metrics GET error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/devgate/log
 * Get last update info from _log.ndjson
 */
router.get('/log', async (_req: Request, res: Response) => {
  try {
    const logPath = join(DATA_DIR, '_log.ndjson');

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      if (lines.length === 0) {
        return res.json({
          lastUpdate: null,
          totalUpdates: 0,
        });
      }

      const lastLine = lines[lines.length - 1];
      const lastEntry = JSON.parse(lastLine);

      return res.json({
        lastUpdate: lastEntry,
        totalUpdates: lines.length,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.json({
          lastUpdate: null,
          totalUpdates: 0,
        });
      }
      throw err;
    }
  } catch (error: unknown) {
    console.error('DevGate log GET error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
