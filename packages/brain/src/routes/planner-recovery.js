import { Router } from 'express';

import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { consumePlannerRecoveryReceipt as defaultConsume } from '../orchestrator/planner-recovery-consumption-store.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'idempotency_key')) return null;
  if (
    body.idempotency_key !== undefined
    && !IDEMPOTENCY_KEY_PATTERN.test(body.idempotency_key)
  ) return null;
  return { idempotencyKey: body.idempotency_key ?? null };
}

export function createPlannerRecoveryRouter({ consumePlannerRecoveryReceipt = defaultConsume } = {}) {
  const router = Router();
  router.post('/:predecessorRunId/planner-recovery', internalAuthOrLoopback, async (req, res) => {
    const { predecessorRunId } = req.params;
    const parsed = parseBody(req.body);
    if (!UUID_PATTERN.test(predecessorRunId ?? '') || !parsed) {
      return res.status(400).json({
        success: false,
        error: { code: 'planner_recovery_request_invalid' },
      });
    }
    try {
      const requestPool = req.app.get('pool') || pool;
      const result = await consumePlannerRecoveryReceipt(requestPool, {
        predecessorRunId,
        idempotencyKey: parsed.idempotencyKey,
      });
      return res.status(result.deduplicated ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
      const status = Number(error?.httpStatus);
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          success: false,
          error: { code: error.code ?? 'planner_recovery_rejected' },
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: 'planner_recovery_internal_error' },
      });
    }
  });
  return router;
}
