/**
 * Core Dashboard Server
 * Serves both Core and Dashboard frontends based on hostname
 * Proxies /api/v1/* to autopilot backend
 */

import express from 'express';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5211;
const AUTOPILOT_BACKEND = process.env.AUTOPILOT_BACKEND || 'http://localhost:3333';

// Feishu auth backend
const FEISHU_AUTH_BACKEND = process.env.FEISHU_AUTH_BACKEND || 'http://localhost:3002';

// N8N backend (for workflow automation)
const N8N_BACKEND = process.env.N8N_BACKEND || 'http://localhost:5678';

// Cecelia Quality API (quality monitoring)
const QUALITY_API = process.env.QUALITY_API || 'http://localhost:5220';

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

// Static frontend files (single frontend, theme switches by hostname in JS)
const frontendPath = process.env.DASHBOARD_FRONTEND_PATH || join(__dirname, '../../frontend/dist');
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
