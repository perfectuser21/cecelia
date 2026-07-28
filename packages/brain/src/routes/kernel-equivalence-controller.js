import { timingSafeEqual } from 'node:crypto';

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTROLLER_ERROR_PATTERN =
  /^(?:production_controller|trusted_execution)_[a-z0-9_]+$/;

function exactCaseRequest(value) {
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && Object.hasOwn(value, 'case_id')
    && UUID_PATTERN.test(value.case_id ?? '')
  );
}

function bearerToken(req) {
  const authorization = req.get('authorization') ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function authorize(req, expectedToken) {
  if (
    typeof expectedToken !== 'string'
    || expectedToken.length < 32
    || expectedToken.length > 4_096
    || /[\0\r\n]/.test(expectedToken)
  ) {
    return 'unconfigured';
  }
  const provided = bearerToken(req);
  const expected = Buffer.from(expectedToken, 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return (
    expected.length === actual.length
    && timingSafeEqual(expected, actual)
  )
    ? 'authorized'
    : 'unauthorized';
}

function trustedController(value) {
  return (
    Object.isFrozen(value)
    && value?.owner_service === 'brain.kernel_equivalence.controller'
    && value?.capability_id
      === 'brain.kernel_equivalence.production_controller.v1'
    && typeof value?.executeCase === 'function'
  );
}

const executionRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'kernel-equivalence-controller-execution',
  message: {
    ok: false,
    error: 'production_controller_rate_limited',
  },
});

export function createKernelEquivalenceControllerRouter({
  getController,
  getToken,
} = {}) {
  if (
    typeof getController !== 'function'
    || typeof getToken !== 'function'
  ) {
    throw new TypeError('kernel_equivalence_controller_route_invalid');
  }
  const router = Router();
  router.post('/cases/execute', executionRateLimit, async (req, res) => {
    const authorization = authorize(req, getToken());
    if (authorization === 'unconfigured') {
      return res.status(503).json({
        ok: false,
        error: 'production_controller_auth_unconfigured',
      });
    }
    if (authorization !== 'authorized') {
      return res.status(401).json({
        ok: false,
        error: 'production_controller_unauthorized',
      });
    }
    if (!exactCaseRequest(req.body)) {
      return res.status(400).json({
        ok: false,
        error: 'production_controller_request_invalid',
      });
    }
    const controller = getController();
    if (!trustedController(controller)) {
      return res.status(503).json({
        ok: false,
        error: 'production_controller_unavailable',
      });
    }
    try {
      const result = await controller.executeCase(req.body.case_id);
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      const code = CONTROLLER_ERROR_PATTERN.test(error?.code ?? '')
        ? error.code
        : 'production_controller_execution_failed';
      const status = (
        code === 'production_controller_case_already_claimed'
        || code === 'production_controller_authority_unavailable'
        || code === 'production_controller_authority_invalid'
      )
        ? 409
        : 503;
      return res.status(status).json({ ok: false, error: code });
    }
  });
  return router;
}

export default createKernelEquivalenceControllerRouter;
