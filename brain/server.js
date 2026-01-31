import 'dotenv/config';
import express from 'express';
import brainRoutes from './src/routes.js';
import { initTickLoop } from './src/tick.js';

const app = express();
const PORT = process.env.BRAIN_PORT || 5221;

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

// Mount brain routes
app.use('/api/brain', brainRoutes);

// Health check at root
app.get('/', (_req, res) => {
  res.json({ service: 'cecelia-brain', status: 'running', port: PORT });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, async () => {
  console.log(`Cecelia Brain running on http://localhost:${PORT}`);

  // Initialize tick loop if enabled in DB
  await initTickLoop();
});

export default app;
