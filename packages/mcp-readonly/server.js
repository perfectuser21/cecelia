import express from 'express';

export function createApp({ skipDbInit = false } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ uptime: process.uptime() });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
