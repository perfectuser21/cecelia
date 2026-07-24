import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import {
  CODEX_SLOT_ERROR_MATRIX,
  CodexSlotError,
  acquireCodexSlot,
  reapCodexSlots,
  stopCodexSlot,
} from '../codex-slot-broker.js';

const router = Router();
const ROUTE_ERROR_CODES = [
  'INVALID_REQUEST',
  'FORBIDDEN_IDENTITY',
  'ACCOUNT_BUSY',
  'ROLLOUT_FROZEN',
  'AGENT_UNAVAILABLE',
  'DURABILITY_FAILED',
];
if (ROUTE_ERROR_CODES.some(code => !CODEX_SLOT_ERROR_MATRIX[code])) {
  throw new Error('Codex Slot route error matrix is incomplete');
}

function tokenDigest(value) {
  return createHash('sha256').update(value || '', 'utf8').digest();
}

function hasValidBearer(req) {
  const expected = process.env.CODEX_SLOT_BROKER_TOKEN || '';
  const authorization = req.get('authorization') || '';
  const actual = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return expected.length > 0 && actual.length > 0
    && timingSafeEqual(tokenDigest(actual), tokenDigest(expected));
}

function errorBody(error) {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    ok: false,
  };
}

function sendError(res, error) {
  const finiteError = error instanceof CodexSlotError
    ? error
    : new CodexSlotError('DURABILITY_FAILED', error);
  return res.status(finiteError.httpStatus).json(errorBody(finiteError));
}

function requireBrokerAuth(req, res, next) {
  if (!hasValidBearer(req)) return sendError(res, new CodexSlotError('UNAUTHENTICATED'));
  return next();
}

function identityHeaders(req) {
  return {
    identityKind: req.get('x-codex-slot-identity-kind') || '',
    identityRef: req.get('x-codex-slot-identity-ref') || '',
  };
}

router.use(requireBrokerAuth);

router.post('/acquire', async (req, res) => {
  try {
    const result = await acquireCodexSlot({
      body: req.body,
      idempotencyKey: req.get('idempotency-key') || '',
      ...identityHeaders(req),
    });
    return res.status(201).json({ ok: true, session: result.public });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:session_id/stop', async (req, res) => {
  try {
    const session = await stopCodexSlot({
      body: req.body,
      sessionId: req.params.session_id,
      ...identityHeaders(req),
    });
    return res.status(200).json({ ok: true, session });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/reap', async (req, res) => {
  try {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 0) {
      throw new CodexSlotError('INVALID_REQUEST');
    }
    const summary = await reapCodexSlots();
    return res.status(200).json({ ok: true, summary });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
