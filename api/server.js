#!/usr/bin/env node
/**
 * Cecelia Quality Platform - Dashboard API
 * Lightweight read-only API for Core Dashboard
 *
 * P0 Endpoints (Read-only):
 * - GET /api/state       - Global system state
 * - GET /api/queue       - Queue status + top N tasks
 * - GET /api/runs        - Recent runs list
 * - GET /api/runs/:runId - Single run detail
 *
 * P1 Endpoints (Write):
 * - POST /api/enqueue    - Enqueue new task
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Configuration
const PORT = process.env.CECELIA_API_PORT || 5681;
const HOST = process.env.CECELIA_API_HOST || '0.0.0.0';
const API_TOKEN = process.env.CECELIA_API_TOKEN || ''; // Optional for P1 endpoints

const PROJECT_ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(PROJECT_ROOT, 'state/state.json');
const QUEUE_FILE = path.join(PROJECT_ROOT, 'queue/queue.jsonl');
const RUNS_DIR = path.join(PROJECT_ROOT, 'runs');
const DB_FILE = path.join(PROJECT_ROOT, 'db/cecelia.db');

// Initialize Express
const app = express();
app.use(express.json());
app.use(cors()); // Allow all origins for now (restrict in production)

// Middleware: API Token check (only for write endpoints)
function requireAuth(req, res, next) {
  if (!API_TOKEN) {
    // No token configured, allow all (development mode)
    return next();
  }

  const token = req.headers['x-cecelia-token'];
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// Helper: Read JSON file safely
function readJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return fallback;
  }
}

// Helper: Read JSONL file
function readJSONL(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return [];
  }
}

// Helper: Get recent runs from filesystem
function getRecentRuns(limit = 20) {
  try {
    if (!fs.existsSync(RUNS_DIR)) return [];

    const runDirs = fs.readdirSync(RUNS_DIR)
      .filter(name => fs.statSync(path.join(RUNS_DIR, name)).isDirectory())
      .map(name => {
        const runPath = path.join(RUNS_DIR, name);
        const stat = fs.statSync(runPath);
        const taskFile = path.join(runPath, 'task.json');
        const summaryFile = path.join(runPath, 'summary.json');
        const resultFile = path.join(runPath, 'result.json');

        const task = readJSON(taskFile);
        const summary = readJSON(summaryFile);
        const result = readJSON(resultFile);

        return {
          runId: name,
          createdAt: stat.mtime.toISOString(),
          task: task ? {
            taskId: task.taskId,
            intent: task.intent,
            priority: task.priority,
            source: task.source
          } : null,
          status: result?.status || summary?.status || 'unknown',
          duration: summary?.duration || null,
          exitCode: summary?.exitCode || result?.exitCode || null
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    return runDirs;
  } catch (err) {
    console.error('Error getting recent runs:', err.message);
    return [];
  }
}

// Helper: Query SQLite database
async function queryDB(sql) {
  try {
    const { stdout } = await execPromise(`sqlite3 -json "${DB_FILE}" "${sql}"`);
    return JSON.parse(stdout || '[]');
  } catch (err) {
    console.error('Error querying DB:', err.message);
    return [];
  }
}

// ============================================
// P0 Endpoints (Read-only)
// ============================================

/**
 * GET /api/state
 * Returns global system state
 */
app.get('/api/state', async (req, res) => {
  try {
    // Read state.json
    const state = readJSON(STATE_FILE, {
      health: 'unknown',
      queueLength: 0,
      lastRun: null,
      lastHeartbeat: null
    });

    // Get system health from DB (if available)
    let systemHealth = null;
    if (fs.existsSync(DB_FILE)) {
      const health = await queryDB('SELECT * FROM system_health LIMIT 1;');
      if (health.length > 0) {
        systemHealth = health[0];
      }
    }

    // Get queue length
    const queue = readJSONL(QUEUE_FILE);
    const queueLength = queue.length;

    // Count tasks by priority
    const priorityCounts = {
      P0: queue.filter(t => t.priority === 'P0').length,
      P1: queue.filter(t => t.priority === 'P1').length,
      P2: queue.filter(t => t.priority === 'P2').length
    };

    res.json({
      health: state.health || 'ok',
      queueLength,
      priorityCounts,
      lastRun: state.lastRun,
      lastHeartbeat: state.lastHeartbeat,
      lastSyncNotion: state.lastSyncNotion,
      stats: state.stats,
      systemHealth,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/queue
 * Returns queue status + top N tasks
 */
app.get('/api/queue', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const queue = readJSONL(QUEUE_FILE);

    // Sort by priority (P0 > P1 > P2) and createdAt
    const sorted = queue.sort((a, b) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json({
      total: queue.length,
      byPriority: {
        P0: queue.filter(t => t.priority === 'P0').length,
        P1: queue.filter(t => t.priority === 'P1').length,
        P2: queue.filter(t => t.priority === 'P2').length
      },
      tasks: sorted.slice(0, limit),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/queue:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/runs
 * Returns recent runs list
 */
app.get('/api/runs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const status = req.query.status; // Filter by status (optional)

    let runs = getRecentRuns(limit * 2); // Get more then filter

    // Filter by status if specified
    if (status) {
      runs = runs.filter(r => r.status === status);
    }

    // Limit
    runs = runs.slice(0, limit);

    // Get stats
    const allRuns = getRecentRuns(100);
    const stats = {
      total: allRuns.length,
      succeeded: allRuns.filter(r => r.status === 'succeeded' || r.status === 'completed').length,
      failed: allRuns.filter(r => r.status === 'failed').length,
      running: allRuns.filter(r => r.status === 'running').length
    };

    res.json({
      runs,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/runs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/runs/:runId
 * Returns single run detail with evidence
 */
app.get('/api/runs/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const runPath = path.join(RUNS_DIR, runId);

    if (!fs.existsSync(runPath)) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Read all files
    const task = readJSON(path.join(runPath, 'task.json'));
    const summary = readJSON(path.join(runPath, 'summary.json'));
    const result = readJSON(path.join(runPath, 'result.json'));

    // Get logs (last 200 lines)
    const workerLog = path.join(runPath, 'worker.log');
    let logs = '';
    if (fs.existsSync(workerLog)) {
      const fullLog = fs.readFileSync(workerLog, 'utf8');
      const lines = fullLog.split('\n');
      logs = lines.slice(-200).join('\n');
    }

    // Get evidence files
    const evidencePath = path.join(runPath, 'evidence');
    let evidence = [];
    if (fs.existsSync(evidencePath)) {
      evidence = fs.readdirSync(evidencePath).map(filename => {
        const filePath = path.join(evidencePath, filename);
        const stat = fs.statSync(filePath);
        return {
          filename,
          type: filename.includes('.md') ? 'report' :
                filename.includes('.log') ? 'log' :
                filename.includes('.json') ? 'data' : 'other',
          size: stat.size,
          path: `/api/runs/${runId}/evidence/${filename}` // URL for download
        };
      });
    }

    res.json({
      runId,
      task,
      summary,
      result,
      evidence,
      logs,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/runs/:runId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/runs/:runId/evidence/:filename
 * Download evidence file
 */
app.get('/api/runs/:runId/evidence/:filename', (req, res) => {
  try {
    const { runId, filename } = req.params;
    const filePath = path.join(RUNS_DIR, runId, 'evidence', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set content type based on extension
    const ext = path.extname(filename).toLowerCase();
    const contentType = {
      '.md': 'text/markdown',
      '.log': 'text/plain',
      '.json': 'application/json',
      '.txt': 'text/plain'
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch (err) {
    console.error('Error serving evidence file:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/failures
 * Returns top failures (RCI/GP)
 */
app.get('/api/failures', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);

    // Get failed runs
    const runs = getRecentRuns(100);
    const failed = runs
      .filter(r => r.status === 'failed')
      .slice(0, limit)
      .map(r => ({
        runId: r.runId,
        taskId: r.task?.taskId,
        intent: r.task?.intent,
        priority: r.task?.priority,
        createdAt: r.createdAt,
        exitCode: r.exitCode
      }));

    res.json({
      failures: failed,
      total: failed.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/failures:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// P1 Endpoints (Write) - Require auth
// ============================================

/**
 * POST /api/enqueue
 * Enqueue new task (requires auth)
 */
app.post('/api/enqueue', requireAuth, async (req, res) => {
  try {
    const { source, intent, priority, payload } = req.body;

    // Validate
    if (!source || !intent || !priority || !payload) {
      return res.status(400).json({
        error: 'Missing required fields: source, intent, priority, payload'
      });
    }

    // Call gateway CLI
    const gatewayScript = path.join(PROJECT_ROOT, 'gateway/gateway.sh');
    const payloadStr = JSON.stringify(payload);

    const { stdout } = await execPromise(
      `bash "${gatewayScript}" add "${source}" "${intent}" "${priority}" '${payloadStr}'`
    );

    res.json({
      success: true,
      message: 'Task enqueued',
      output: stdout
    });
  } catch (err) {
    console.error('Error in /api/enqueue:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Health & Info
// ============================================

/**
 * GET /api/health
 * API health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'cecelia-quality-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * API documentation
 */
app.get('/', (req, res) => {
  res.json({
    name: 'Cecelia Quality Platform - Dashboard API',
    version: '1.0.0',
    endpoints: {
      'GET /api/state': 'Global system state',
      'GET /api/queue': 'Queue status + top N tasks',
      'GET /api/runs': 'Recent runs list',
      'GET /api/runs/:runId': 'Single run detail',
      'GET /api/runs/:runId/evidence/:filename': 'Download evidence file',
      'GET /api/failures': 'Top failures',
      'POST /api/enqueue': 'Enqueue new task (requires auth)',
      'GET /api/health': 'API health check'
    },
    docs: 'https://github.com/zenjoymedia/cecelia-quality'
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`✅ Cecelia Quality API running on http://${HOST}:${PORT}`);
  console.log('');
  console.log('P0 Endpoints (Read-only):');
  console.log(`  GET  http://${HOST}:${PORT}/api/state`);
  console.log(`  GET  http://${HOST}:${PORT}/api/queue`);
  console.log(`  GET  http://${HOST}:${PORT}/api/runs`);
  console.log(`  GET  http://${HOST}:${PORT}/api/runs/:runId`);
  console.log(`  GET  http://${HOST}:${PORT}/api/failures`);
  console.log('');
  console.log('P1 Endpoints (Write - requires auth):');
  console.log(`  POST http://${HOST}:${PORT}/api/enqueue`);
  console.log('');
  if (!API_TOKEN) {
    console.log('⚠️  Warning: CECELIA_API_TOKEN not set, auth is disabled');
  } else {
    console.log('✅ Auth enabled with CECELIA_API_TOKEN');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(0);
});
