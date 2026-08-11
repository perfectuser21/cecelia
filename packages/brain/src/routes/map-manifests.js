import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { validateMapManifest } from '../lib/map-manifest-schema.js';
import {
  MapManifestError,
  activateMapManifest,
  submitMapManifest,
} from '../lib/map-manifest-store.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

function sendError(res, error) {
  if (error instanceof MapManifestError) {
    const body = {
      error: {
        code: error.code,
        message: error.message,
      },
    };
    if (error.details !== undefined) body.error.details = error.details;
    return res.status(error.status).json(body);
  }
  console.error('[map-manifests] unexpected error:', error);
  return res.status(500).json({
    error: {
      code: 'MAP_MANIFEST_INTERNAL_ERROR',
      message: 'Failed to process map manifest',
    },
  });
}

export function createMapManifestRouter({ pool, projector, services } = {}) {
  const router = Router();
  router.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }));
  router.use(internalAuthOrLoopback);
  const validate = services?.validate ?? validateMapManifest;
  const submit = services?.submit ?? submitMapManifest;
  const activate = services?.activate ?? activateMapManifest;

  router.post('/validate', (req, res) => {
    const result = validate(req.body);
    return res.status(result.valid ? 200 : 422).json(result);
  });

  router.post('/', async (req, res) => {
    try {
      const result = await submit(pool, req.body);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/:id/activate', async (req, res) => {
    try {
      const result = await activate(pool, req.params.id, { projector });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

export default createMapManifestRouter;
