/**
 * Intent Recognition API Controller
 *
 * Handles HTTP requests for the intent recognition endpoint
 */

import { Request, Response } from 'express';
import { recognizeIntent, toBrainAction } from '../services/intent-recognition.service.js';
import {
  RecognizeIntentRequest,
  RecognizeIntentResponse,
} from '../types/intent.types.js';

/**
 * POST /api/intent/recognize
 *
 * Recognize intent from natural language input
 *
 * Request body:
 * - text: string (required) - Natural language input
 * - context?: object (optional) - Context for better recognition
 * - confidenceThreshold?: number (optional) - Minimum confidence threshold (0-1)
 *
 * Response:
 * - success: boolean
 * - result?: IntentRecognitionResult
 * - suggestedAction?: SuggestedAction
 * - error?: string
 */
export async function recognizeIntentHandler(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  try {
    // Validate request body
    const { text, context, confidenceThreshold } = req.body as RecognizeIntentRequest;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      const response: RecognizeIntentResponse = {
        success: false,
        error: 'Invalid request',
        details: 'Text field is required and must be a non-empty string',
      };
      res.status(400).json(response);
      return;
    }

    // Validate confidenceThreshold
    if (confidenceThreshold !== undefined) {
      if (typeof confidenceThreshold !== 'number' || confidenceThreshold < 0 || confidenceThreshold > 1) {
        const response: RecognizeIntentResponse = {
          success: false,
          error: 'Invalid request',
          details: 'confidenceThreshold must be a number between 0 and 1',
        };
        res.status(400).json(response);
        return;
      }
    }

    // Validate context structure (basic validation)
    if (context !== undefined && typeof context !== 'object') {
      const response: RecognizeIntentResponse = {
        success: false,
        error: 'Invalid request',
        details: 'context must be an object',
      };
      res.status(400).json(response);
      return;
    }

    // Build recognition request
    const request: RecognizeIntentRequest = {
      text: text.trim(),
      context,
      confidenceThreshold,
    };

    // Perform intent recognition
    const result = recognizeIntent(request);

    // Generate suggested Brain API action
    const suggestedAction = toBrainAction(result, context);

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Build response
    const response: RecognizeIntentResponse = {
      success: true,
      result,
      suggestedAction,
    };

    // Log performance (ensure < 500ms requirement)
    if (responseTime > 500) {
      console.warn(`[Intent Recognition] Slow response: ${responseTime}ms for input: "${text}"`);
    }

    res.status(200).json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const responseTime = Date.now() - startTime;

    console.error(`[Intent Recognition] Error after ${responseTime}ms:`, error);

    const response: RecognizeIntentResponse = {
      success: false,
      error: 'Internal server error',
      details: errorMessage,
    };

    res.status(500).json(response);
  }
}

/**
 * GET /api/intent/health
 *
 * Health check endpoint for intent recognition service
 */
export async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    status: 'healthy',
    service: 'intent-recognition',
    version: '1.0.0',
  });
}
