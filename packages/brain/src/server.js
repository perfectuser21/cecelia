import express from 'express';
import harnessRouter from './routes/harness.js';

export function createApp(_opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', harnessRouter);
  return app;
}
