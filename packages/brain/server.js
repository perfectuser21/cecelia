import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import brainRoutes from './src/routes.js';
import ceceliaRoutes from './src/cecelia-routes.js';
import traceRoutes from './src/trace-routes.js';
import memoryRoutes from './src/routes/memory.js';
import profileFactsRoutes from './src/routes/profile-facts.js';
import clusterRoutes from './src/routes/cluster.js';
import vpsMonitorRoutes from './src/routes/vps-monitor.js';
import taskProjectsRoutes from './src/routes/task-projects.js';
import taskGoalsRoutes from './src/routes/task-goals.js';
import taskAreasRoutes from './src/routes/task-areas.js';
import taskTasksRoutes from './src/routes/task-tasks.js';
import innerLifeRoutes from './src/routes/inner-life.js';
import intentMatchRoutes from './src/routes/intent-match.js';
import selfReportsRoutes from './src/routes/self-reports.js';
import narrativesRoutes from './src/routes/narratives.js';
import cognitiveMapRoutes from './src/routes/cognitive-map.js';
import brainManifestRoutes from './src/routes/brain-manifest.js';
import perceptionSignalsRoutes from './src/routes/perception-signals.js';
import architectureRoutes from './src/routes/architecture.js';
import taskRouterDiagnoseRoutes from './src/routes/task-router-diagnose.js';
import notebookAuditRoutes from './src/routes/notebook-audit.js';
import alertingRoutes from './src/routes/alerting.js';
import systemReportsRoutes from './src/routes/system-reports.js';
import evolutionRoutes from './src/routes/evolution.js';
import recurringRoutes from './src/routes/recurring.js';
import statsRoutes from './src/routes/stats.js';
import alexPagesRoutes from './src/routes/alex-pages.js';
import metricsRoutes from './src/routes/metrics.js';
import ruminationRoutes from './src/routes/rumination.js';
import curiosityRoutes from './src/routes/curiosity.js';
import { initTickLoop } from './src/tick.js';
import { runSelfCheck } from './src/selfcheck.js';
import { runMigrations } from './src/migrate.js';
import pool from './src/db.js';
import { initNarrativeTimer } from './src/cognitive-core.js';
import { initWebSocketServer, shutdownWebSocketServer } from './src/websocket.js';
import { loadActiveProfile } from './src/model-profile.js';
import { loadSpendingCapsFromDB } from './src/account-usage.js';
import { WebSocketServer } from 'ws';
import { handleRealtimeWebSocket } from './src/orchestrator-realtime.js';
import { handleChat } from './src/orchestrator-chat.js';
import { getScanStatus } from './src/task-generator-scheduler.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || process.env.BRAIN_PORT || 5221;

// ============== Process-level Exception Handlers ==============
// Prevent uncaught exceptions from crashing the entire service
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  // Log to file/monitoring service here
  // For now, keep running (don't exit)
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  // Log to file/monitoring service here
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await shutdownWebSocketServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await shutdownWebSocketServer();
  process.exit(0);
});
// ============================================================

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parser
app.use(express.json({ limit: '256kb' }));

// Mount memory routes (before brain routes to avoid conflicts)
app.use('/api/brain/memory', memoryRoutes);
app.use('/api/brain/profile/facts', profileFactsRoutes);

// Migrated local routes (from apps/api → Brain)
app.use('/api/brain/cluster', clusterRoutes);
app.use('/api/brain/vps-monitor', vpsMonitorRoutes);
app.use('/api/brain/tasks/projects', taskProjectsRoutes);
app.use('/api/brain/projects', taskProjectsRoutes); // 供 /decomp SKILL.md Phase 2 引用
app.use('/api/brain/tasks/goals', taskGoalsRoutes);
app.use('/api/brain/goals', taskGoalsRoutes); // 别名，供 /api/brain/goals/audit 访问
app.use('/api/brain/tasks/areas', taskAreasRoutes);
app.use('/api/brain/tasks/tasks', taskTasksRoutes);
app.use('/api/brain/inner-life', innerLifeRoutes);
app.use('/api/brain/intent', intentMatchRoutes);
app.use('/api/brain/self-reports', selfReportsRoutes);
app.use('/api/brain/narratives', narrativesRoutes);
app.use('/api/brain/cognitive-map', cognitiveMapRoutes);
app.use('/api/brain/manifest', brainManifestRoutes);
app.use('/api/brain/perception-signals', perceptionSignalsRoutes);
app.use('/api/brain/architecture', architectureRoutes);
app.use('/api/brain/task-router', taskRouterDiagnoseRoutes);
app.use('/api/brain/notebook-audit', notebookAuditRoutes);
app.use('/api/brain/alerting', alertingRoutes);
app.use('/api/brain/reports', systemReportsRoutes);
app.use('/api/brain/evolution', evolutionRoutes);
app.use('/api/brain/recurring-tasks', recurringRoutes);
app.use('/api/brain/stats', statsRoutes);
app.use('/api/brain/alex-pages', alexPagesRoutes);
app.use('/api/brain/metrics', metricsRoutes);
app.use('/api/brain/rumination', ruminationRoutes);
app.use('/api/brain/curiosity', curiosityRoutes);

// Mount brain routes
app.use('/api/brain', brainRoutes);

// POST /api/brain/tasks fallback: brainRoutes 无 POST /tasks handler，此处补齐
// 必须在 brainRoutes 之后，避免干扰已有 GET/PATCH /api/brain/tasks
app.use('/api/brain/tasks', taskTasksRoutes);

// Mount cecelia task execution routes
app.use('/api/cecelia', ceceliaRoutes);

// Mount trace observability routes
app.use('/api/brain/trace', traceRoutes);

// GET /api/brain/scan-status
app.get('/api/brain/scan-status', (_req, res) => {
  try {
    res.json(getScanStatus());
  } catch (err) {
    console.error('[scan-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/orchestrator/chat
app.post('/api/brain/orchestrator/chat', async (req, res) => {
  try {
    const { message, messages = [], context = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const result = await handleChat(message, context, messages);
    res.json(result);
  } catch (err) {
    console.error('[orchestrator/chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check at root
app.get('/', (_req, res) => {
  res.json({ service: 'cecelia-brain', status: 'running', port: PORT });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// Run migrations and self-check before starting
try {
  await runMigrations(pool);
} catch (err) {
  console.error('[FATAL] Migration failed:', err.message);
  process.exit(1);
}

const selfCheckOk = await runSelfCheck(pool);
if (!selfCheckOk) {
  console.error('[FATAL] Self-check failed. Brain will NOT start.');
  process.exit(1);
}

// Load active model profile
try {
  await loadActiveProfile(pool);
  console.log('[Server] Model profile loaded');
} catch (err) {
  console.warn('[Server] Failed to load model profile, using fallback:', err.message);
}

// Restore spending cap state from DB (survives Brain restarts)
await loadSpendingCapsFromDB();

// Realtime WebSocket server (noServer mode, manually handle upgrade)
const realtimeWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/api/brain/orchestrator/realtime/ws')) {
    realtimeWss.handleUpgrade(req, socket, head, (ws) => {
      handleRealtimeWebSocket(ws, req);
    });
  }
  // /ws path handled by initWebSocketServer's own WSS
});

/**
 * Auto-start cecelia-bridge on port 3457 if not already running.
 * Idempotent: skips if /health returns 200.
 */
async function startCeceliaBridge() {
  const BRIDGE_PORT = process.env.BRIDGE_PORT || 3457;
  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;
  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log('[Server] cecelia-bridge already running on port', BRIDGE_PORT);
      return;
    }
  } catch (_) {
    // Not running — will start below
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const bridgeScript = join(__dirname, 'scripts', 'cecelia-bridge.js');
  const logFile = createWriteStream('/tmp/cecelia-bridge.log', { flags: 'a' });

  const child = spawn(process.execPath, [bridgeScript], {
    detached: false,
    stdio: ['ignore', logFile, logFile],
    env: { ...process.env, BRIDGE_PORT: String(BRIDGE_PORT) },
  });

  child.on('error', (err) => {
    console.error('[Server] Failed to start cecelia-bridge:', err.message);
  });

  child.on('exit', (code, signal) => {
    if (code !== null) {
      console.warn(`[Server] cecelia-bridge exited with code ${code}`);
    }
  });

  console.log(`[Server] cecelia-bridge started (pid=${child.pid}), log: /tmp/cecelia-bridge.log`);
}

server.listen(PORT, async () => {
  console.log(`Cecelia Brain running on http://localhost:${PORT}`);

  // Initialize WebSocket server
  initWebSocketServer(server);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  console.log(`Realtime WebSocket ready at ws://localhost:${PORT}/api/brain/orchestrator/realtime/ws`);

  // Initialize narrative timer from DB (prevent duplicate diary on restart)
  await initNarrativeTimer(pool);
  console.log('[Server] Narrative timer initialized from DB');

  // Startup recovery: re-queue orphaned in_progress tasks from previous Brain instance
  const { runStartupRecovery } = await import('./src/startup-recovery.js');
  await runStartupRecovery(pool);

  // Initialize tick loop if enabled in DB
  await initTickLoop();

  // Initialize Monitoring Loop (auto-healing)
  const { startMonitorLoop } = await import('./src/monitor-loop.js');
  startMonitorLoop();
  console.log('[Server] Monitoring Loop started (30s interval) - P0: Auto-healing for stuck/spike/pressure');

  // Initialize Promotion Job Loop (P1)
  const { startPromotionJobLoop } = await import('./src/promotion-job.js');
  startPromotionJobLoop();
  console.log('[Server] Promotion Job Loop started (10min interval) - P1: Auto-promote probation→active, auto-disable failed');

  // Auto-start cecelia-bridge if not already running
  await startCeceliaBridge();
});

export default app;
