import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import brainRoutes from './src/routes.js';
import ceceliaRoutes from './src/cecelia-routes.js';
import traceRoutes from './src/trace-routes.js';
import memoryRoutes from './src/routes/memory.js';
import profileFactsRoutes from './src/routes/profile-facts.js';
import { initTickLoop } from './src/tick.js';
import { runSelfCheck } from './src/selfcheck.js';
import { runMigrations } from './src/migrate.js';
import pool from './src/db.js';
import { initWebSocketServer, shutdownWebSocketServer } from './src/websocket.js';
import { loadActiveProfile } from './src/model-profile.js';
import { WebSocketServer } from 'ws';
import { handleRealtimeWebSocket } from './src/orchestrator-realtime.js';

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

// Mount brain routes
app.use('/api/brain', brainRoutes);

// Mount cecelia task execution routes
app.use('/api/cecelia', ceceliaRoutes);

// Mount trace observability routes
app.use('/api/brain/trace', traceRoutes);

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

server.listen(PORT, async () => {
  console.log(`Cecelia Brain running on http://localhost:${PORT}`);

  // Initialize WebSocket server
  initWebSocketServer(server);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  console.log(`Realtime WebSocket ready at ws://localhost:${PORT}/api/brain/orchestrator/realtime/ws`);

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
});

export default app;
