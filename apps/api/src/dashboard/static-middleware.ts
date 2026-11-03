import express, { type RequestHandler } from 'express';
import compression from 'compression';
import { join } from 'node:path';

export function createCompressionMiddleware(): RequestHandler {
  return compression() as unknown as RequestHandler;
}

export function createStaticAssetMiddleware(frontendPath: string) {
  const router = express.Router();
  router.use('/assets', express.static(join(frontendPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  router.use(express.static(frontendPath, { maxAge: 0, etag: true }));
  return router;
}

export function createSpaFallback(frontendPath: string): RequestHandler {
  return (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(frontendPath, 'index.html'));
  };
}
