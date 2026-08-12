import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import pool from '../db.js';
import {
  MapReadError,
  mapReadServices,
  runConsistentMapRead,
} from '../lib/map-read-service.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { MapRadiusError, resolveImpactRadius } from '../map/radius.js';

function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code?.endsWith('_NOT_FOUND')) return 404;
  if (error?.code?.includes('NOT_CONFIGURED')) return 422;
  return 500;
}

function sendError(res, error) {
  const known = error instanceof MapReadError || error?.code?.startsWith('MAP_');
  if (!known) console.error('[map] unexpected error:', error);
  const body = {
    error: {
      code: known ? error.code : 'MAP_INTERNAL_ERROR',
      message: known ? error.message : 'Failed to read Unified Map',
    },
  };
  if (known && error.details !== undefined) body.error.details = error.details;
  return res.status(known ? errorStatus(error) : 500).json(body);
}

function validationError(res, code, message) {
  return res.status(400).json({ error: { code, message } });
}

function isImpactContractRadius(body) {
  return body?.base_revision !== undefined || body?.head_revision !== undefined;
}

function protectImpactContractRadius(req, res, next) {
  if (!isImpactContractRadius(req.body)) return next();
  return internalAuthOrLoopback(req, res, next);
}

export function createMapRouter({
  pool: databasePool = pool,
  services = mapReadServices,
  impactRadius = resolveImpactRadius,
  now = () => new Date(),
} = {}) {
  const router = Router();
  router.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }));

  async function consistentRead(res, reader) {
    try {
      const result = await runConsistentMapRead(databasePool, reader);
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  }

  router.get('/', async (req, res) => {
    const scopeKey = req.query.scope;
    if (!scopeKey) return validationError(res, 'MAP_SCOPE_REQUIRED', 'scope query parameter is required');
    const readAt = now();
    return consistentRead(res, (client) => services.readMap(client, { scopeKey, now: readAt }));
  });

  router.get('/nodes/:key', async (req, res) => {
    const scopeKey = req.query.scope;
    if (!scopeKey) return validationError(res, 'MAP_SCOPE_REQUIRED', 'scope query parameter is required');
    const readAt = now();
    return consistentRead(res, (client) => services.readNode(client, {
      scopeKey,
      nodeKey: req.params.key,
      now: readAt,
    }));
  });

  router.post('/radius', protectImpactContractRadius, async (req, res) => {
    if (isImpactContractRadius(req.body)) {
      try {
        return res.json(await impactRadius(req.body));
      } catch (error) {
        const status = error instanceof MapRadiusError ? error.httpStatus : 500;
        return res.status(status).json({
          error: error.message,
          code: error.code ?? 'map_radius_failed',
        });
      }
    }

    const {
      scope: scopeKey,
      repo,
      changed_files: changedFiles,
      node_keys: startNodeKeys = [],
      max_depth: maxDepth = 10,
    } = req.body ?? {};
    if (!scopeKey || !repo || !Array.isArray(changedFiles) || !Array.isArray(startNodeKeys)
      || (changedFiles.length === 0 && startNodeKeys.length === 0)
      || !Number.isInteger(maxDepth) || maxDepth < 1) {
      return validationError(
        res,
        'MAP_RADIUS_INPUT_INVALID',
        'scope, repo, and at least one changed_file or node_key are required',
      );
    }
    const readAt = now();
    return consistentRead(res, (client) => services.readRadius(client, {
      scopeKey,
      repo,
      changedFiles,
      startNodeKeys,
      maxDepth,
      now: readAt,
    }));
  });

  router.get('/health', async (req, res) => {
    const scopeKey = req.query.scope;
    if (!scopeKey) return validationError(res, 'MAP_SCOPE_REQUIRED', 'scope query parameter is required');
    const readAt = now();
    return consistentRead(res, (client) => services.readHealth(client, { scopeKey, now: readAt }));
  });

  router.get('/unclaimed', async (req, res) => {
    const scopeKey = req.query.scope;
    if (!scopeKey) return validationError(res, 'MAP_SCOPE_REQUIRED', 'scope query parameter is required');
    const readAt = now();
    return consistentRead(res, (client) => services.readUnclaimed(client, { scopeKey, now: readAt }));
  });

  router.post('/rebuild', internalAuthOrLoopback, async (req, res) => {
    const scopeKey = req.body?.scope_key;
    if (!scopeKey) return validationError(res, 'MAP_SCOPE_REQUIRED', 'scope_key is required');
    try {
      return res.json(await services.rebuild(databasePool, { scopeKey, now: now() }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

export default createMapRouter({ pool });
