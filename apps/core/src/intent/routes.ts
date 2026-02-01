/**
 * Intent Recognition Routes
 * Base path: /api/intent
 *
 * Provides endpoints for natural language intent recognition
 */

import { Router } from 'express';
import { recognizeIntentHandler, healthCheckHandler } from '../controllers/intent.controller.js';

const router = Router();

/**
 * POST /api/intent/recognize
 * Recognize intent from natural language input
 */
router.post('/recognize', recognizeIntentHandler);

/**
 * GET /api/intent/health
 * Health check endpoint
 */
router.get('/health', healthCheckHandler);

export default router;
