/**
 * Intent Recognition Service
 *
 * Core service for recognizing user intent from natural language input.
 * Maps natural language to OKR/Project/Task operations.
 */

import {
  IntentType,
  IntentRecognitionResult,
  RecognizeIntentRequest,
  SuggestedAction,
  CreateGoalParams,
  CreateTaskParams,
  UpdateTaskParams,
  QueryTasksParams,
} from '../types/intent.types.js';
import {
  extractIntent,
  extractEntities,
  getConfidenceLevel,
  generateExplanation,
} from '../utils/nlp-parser.js';

/**
 * Main intent recognition function
 *
 * @param request Recognition request with natural language input
 * @returns Intent recognition result with extracted entities
 */
export function recognizeIntent(request: RecognizeIntentRequest): IntentRecognitionResult {
  const { text, confidenceThreshold = 0.3 } = request;

  if (!text || text.trim().length === 0) {
    throw new Error('Input text cannot be empty');
  }

  // Step 1: Extract intent type and confidence
  const { intent, confidence, matchedPhrases } = extractIntent(text);

  // Step 2: Extract entities
  const entities = extractEntities(text, intent);

  // Apply default priority if not extracted
  if (!entities.priority) {
    entities.priority = 'P1'; // Default priority
  }

  // Step 3: Determine if confirmation is needed
  const confidenceLevel = getConfidenceLevel(confidence);
  const requiresConfirmation = confidence < confidenceThreshold || confidenceLevel === 'low';

  // Step 4: Generate explanation
  const explanation = generateExplanation(intent, entities, confidence);

  // Step 5: Build recognition result
  const result: IntentRecognitionResult = {
    intent,
    confidence,
    confidenceLevel,
    entities,
    originalInput: text,
    matchedPhrases,
    requiresConfirmation,
    explanation,
  };

  return result;
}

/**
 * Convert intent recognition result to Brain API action
 *
 * @param result Intent recognition result
 * @param context Optional context for resolving references
 * @returns Suggested Brain API action, or undefined if not applicable
 */
export function toBrainAction(
  result: IntentRecognitionResult,
  context?: RecognizeIntentRequest['context']
): SuggestedAction | undefined {
  const { intent, entities, confidence } = result;

  switch (intent) {
    case IntentType.CREATE_GOAL: {
      if (!entities.title) {
        return undefined; // Cannot create goal without title
      }

      const params: CreateGoalParams = {
        title: entities.title,
        priority: entities.priority,
      };

      if (entities.project) {
        // Try to resolve project name to ID (would need project lookup service)
        // For now, just include as description context
        params.description = `Related to project: ${entities.project}`;
      }

      return {
        action: 'create-goal',
        params,
        confidence,
      };
    }

    case IntentType.CREATE_TASK: {
      if (!entities.title) {
        return undefined; // Cannot create task without title
      }

      const params: CreateTaskParams = {
        title: entities.title,
        priority: entities.priority,
      };

      if (entities.project) {
        params.description = `Related to project: ${entities.project}`;
      }

      if (entities.goal) {
        if (!params.description) {
          params.description = '';
        }
        params.description += ` | Related to goal: ${entities.goal}`;
      }

      return {
        action: 'create-task',
        params,
        confidence,
      };
    }

    case IntentType.UPDATE_TASK: {
      // For update, we need a task_id from context
      // Fuzzy matching by title is not yet implemented
      if (!context?.recentTasks?.[0]) {
        // Cannot create update action without task_id
        // Would require fuzzy task search integration
        return undefined;
      }

      const params: UpdateTaskParams = {
        task_id: context.recentTasks[0],
        status: entities.status,
        priority: entities.priority,
      };

      return {
        action: 'update-task',
        params,
        confidence,
      };
    }

    case IntentType.QUERY_TASKS: {
      const params: QueryTasksParams = {
        status: entities.status, // Single value, not array (Brain API expects either single or array)
        priority: entities.priority, // Single value, not array
        limit: 50, // Default limit
      };

      // Include project/goal context if available
      if (context?.currentProject) {
        params.project_id = typeof context.currentProject === 'number'
          ? context.currentProject
          : undefined;
      }

      if (context?.currentGoal) {
        params.goal_id = typeof context.currentGoal === 'number'
          ? context.currentGoal
          : undefined;
      }

      return {
        action: 'query-tasks',
        params,
        confidence,
      };
    }

    default:
      // For unknown intents or unsupported operations
      return undefined;
  }
}

/**
 * Batch recognize multiple inputs (for future use)
 *
 * @param inputs Array of text inputs
 * @returns Array of recognition results
 */
export function batchRecognize(inputs: string[]): IntentRecognitionResult[] {
  return inputs.map(text =>
    recognizeIntent({ text })
  );
}
