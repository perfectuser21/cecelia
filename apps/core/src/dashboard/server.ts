/**
 * Core Dashboard Server
 * Serves both Core and Dashboard frontends based on hostname
 * Proxies /api/v1/* to autopilot backend
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import routes from './routes.js';
import devRoutes from '../dev/routes.js';
import engineRoutes from '../engine/routes.js';
import githubRoutes from '../github/routes.js';
import workersRoutes from '../workers/routes.js';
import panoramaRoutes from '../panorama/routes.js';
import devgateRoutes from '../devgate/routes.js';
import mediaRoutes from '../media/routes.js';
import taskSystemRoutes from '../task-system/routes.js';
import areasRoutes from '../task-system/areas.js';
// Brain routes migrated to cecelia-semantic-brain (port 5221)
import okrRoutes from '../okr/routes.js';
import watchdogRoutes from '../watchdog/routes.js';
import systemRoutes from '../system/routes.js';
import { startMonitor as startWatchdogMonitor } from '../watchdog/service.js';
// Tick loop migrated to cecelia-semantic-brain
import { auditMiddleware, initAuditTable } from '../middleware/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5211;
const AUTOPILOT_BACKEND = process.env.AUTOPILOT_BACKEND || 'http://localhost:3333';

// Feishu auth backend
const FEISHU_AUTH_BACKEND = process.env.FEISHU_AUTH_BACKEND || 'http://localhost:3002';

// N8N backend (for workflow automation)
const N8N_BACKEND = process.env.N8N_BACKEND || 'http://localhost:5678';

// Cecelia Quality API (quality monitoring) - port 5681
const QUALITY_API = process.env.QUALITY_API || 'http://localhost:5681';

// Cecelia Brain API (semantic brain + orchestrator)
const BRAIN_API = process.env.BRAIN_API || 'http://localhost:5220';

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

// Proxy routes BEFORE body parser (so request body is not consumed)
// Proxy /api/quality to cecelia-quality API
// Note: Express strips the mount path, so /api/quality/state becomes /state in the middleware
// We need to prepend /api to make it /api/state for the target server
app.use('/api/quality', createProxyMiddleware({
  target: QUALITY_API,
  changeOrigin: true,
  pathRewrite: (path) => `/api${path}`  // /state → /api/state
}));

// Proxy all /api/orchestrator/* to cecelia-brain API
// All orchestrator routes (chat, voice, state, health) are now in Brain
// Note: Express strips mount path, so /api/orchestrator/chat becomes /chat
const orchestratorProxy = createProxyMiddleware({
  target: BRAIN_API,
  changeOrigin: true,
  pathRewrite: (path) => `/orchestrator${path}`,  // /chat → /orchestrator/chat
  ws: true,  // Enable WebSocket proxying for realtime voice
});
app.use('/api/orchestrator', orchestratorProxy);

// Proxy /api/autumnrice/* to cecelia-brain API (R-cell one-click execution)
app.use('/api/autumnrice', createProxyMiddleware({
  target: BRAIN_API,
  changeOrigin: true,
  pathRewrite: (path) => `/autumnrice${path}`,  // /run → /autumnrice/run
}));

// Proxy /api/v1/* to autopilot backend
app.use('/api/v1', createProxyMiddleware({
  target: AUTOPILOT_BACKEND,
  changeOrigin: true,
  pathRewrite: {
    '^/api/v1': '/v1'
  }
}));

// Proxy /n8n/* to N8N container (workflow automation)
app.use('/n8n', createProxyMiddleware({
  target: N8N_BACKEND,
  changeOrigin: true,
  ws: true,
}));

// Middleware
app.use(express.json({ limit: '256kb' }));

// Audit middleware (logs all /api/* requests)
app.use(auditMiddleware);

// Forward /api/feishu-login to feishu-auth-backend
app.post('/api/feishu-login', async (req, res) => {
  try {
    const response = await fetch(`${FEISHU_AUTH_BACKEND}/api/feishu-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch {
    res.status(500).json({ success: false, error: 'Proxy error' });
  }
});

// API routes middleware
app.use('/api', (_req, _res, next) => {
  next();
});

// Local API routes (Cecelia)
app.use('/api/cecelia', routes);

// Dev Task Tracker routes
app.use('/api/dev', devRoutes);

// Engine info routes
app.use('/api/engine', engineRoutes);

// GitHub API routes (for dev panorama)
app.use('/api/github', githubRoutes);

// Workers API routes (unified AI employees)
app.use('/api/workers', workersRoutes);

// Panorama API routes (VPS overview)
app.use('/api/panorama', panoramaRoutes);

// DevGate API routes (metrics from engine)
app.use('/api/devgate', devgateRoutes);

// Claude Accounts API routes (account switcher + usage stats)

// Media Data API routes (social metrics proxy)
app.use('/api/media', mediaRoutes);

// Task System API routes (PARA + OKR)
app.use('/api/tasks', taskSystemRoutes);

// Areas API routes (PARA alignment)
app.use('/api/areas', areasRoutes);

// Brain API routes → proxy to cecelia-semantic-brain Node.js service
const BRAIN_NODE_API = process.env.BRAIN_NODE_API || 'http://localhost:5221';
app.use('/api/brain', createProxyMiddleware({
  target: BRAIN_NODE_API,
  changeOrigin: true,
  pathRewrite: (path) => `/api/brain${path}`,
}));

// OKR Tree API routes (tree-based OKR management)
app.use('/api/okr', okrRoutes);

// Watchdog API routes (agent activity monitoring)
app.use('/api/watchdog', watchdogRoutes);

// System status API routes (aggregated status from all subsystems)
app.use('/api/system', systemRoutes);

// Static frontend files (single frontend, theme switches by hostname in JS)
// Compiled server is at apps/core/dist/dashboard/server.js
// Frontend is at apps/dashboard/frontend/dist
const frontendPath = process.env.DASHBOARD_FRONTEND_PATH || join(__dirname, '../../../dashboard/frontend/dist');
app.use(express.static(frontendPath));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(frontendPath, 'index.html'));
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({
    success: false,
    error: err.message,
  });
});

// Start server with WebSocket support
const server = createServer(app);

// Handle WebSocket upgrade for orchestrator realtime
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/api/orchestrator/realtime/ws')) {
    // Strip /api prefix only - pathRewrite adds /orchestrator
    // /api/orchestrator/realtime/ws -> /realtime/ws -> /orchestrator/realtime/ws (via pathRewrite)
    req.url = '/realtime/ws';
    console.log('[WebSocket Upgrade] Proxying, input URL rewritten to:', req.url);
    orchestratorProxy.upgrade(req, socket as any, head);
  }
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Initialize audit table
  await initAuditTable();

  // Start watchdog monitor automatically
  startWatchdogMonitor();

  // Tick loop now runs in cecelia-semantic-brain Node.js service (port 5221)
});

export default app;
