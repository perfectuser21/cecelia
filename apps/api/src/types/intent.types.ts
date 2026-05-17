/**
 * TypeScript type definitions for Intent Recognition (KR1)
 * Generated from PRD - KR1: 意图识别 - 自然语言→OKR/Project/Task
 */

/**
 * Supported intent types
 */
export enum IntentType {
  CREATE_PROJECT = 'create_project',
  CREATE_FEATURE = 'create_feature',
  CREATE_GOAL = 'create_goal',
  CREATE_TASK = 'create_task',
  QUERY_TASKS = 'query_tasks',
  UPDATE_TASK = 'update_task',
  FIX_BUG = 'fix_bug',
  REFACTOR = 'refactor',
  EXPLORE = 'explore',
  QUESTION = 'question',
  UNKNOWN = 'unknown'
}

/**
 * Task status types
 */
export type TaskStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'blocked';

/**
 * Priority levels
 */
export type Priority = 'P0' | 'P1' | 'P2';

/**
 * Confidence levels
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Extracted entities from natural language input
 */
export interface ExtractedEntities {
  /** Title/name extracted from input */
  title?: string;

  /** Module or component name */
  module?: string;

  /** Feature name */
  feature?: string;

  /** Priority level (P0/P1/P2) */
  priority?: Priority;

  /** Task status */
  status?: TaskStatus;

  /** Associated project/goal ID or name */
  project?: string;
  goal?: string;

  /** File path references */
  filePath?: string;

  /** API endpoint references */
  apiEndpoint?: string;

  /** Component name */
  component?: string;

  /** Timeframe mentions */
  timeframe?: string;

  /** Dependencies */
  dependency?: string;
}

/**
 * Intent recognition result
 */
export interface IntentRecognitionResult {
  /** The recognized intent type */
  intent: IntentType;

  /** Confidence score (0-1) */
  confidence: number;

  /** Confidence level category */
  confidenceLevel: ConfidenceLevel;

  /** Extracted entities */
  entities: ExtractedEntities;

  /** Original input text */
  originalInput: string;

  /** Matched keywords that contributed to classification */
  keywords?: string[];

  /** Matched phrase patterns */
  matchedPhrases?: string[];

  /** Whether user confirmation is recommended (for ambiguous cases) */
  requiresConfirmation: boolean;

  /** Human-readable explanation of the recognition */
  explanation?: string;
}

/**
 * Brain API action parameters for create-goal
 */
export interface CreateGoalParams {
  title: string;
  description?: string;
  priority?: Priority;
  project_id?: number;
  target_date?: string;
}

/**
 * Brain API action parameters for create-task
 */
export interface CreateTaskParams {
  title: string;
  description?: string;
  priority?: Priority;
  project_id?: number;
  goal_id?: number;
  tags?: string[];
}

/**
 * Brain API action parameters for update-task
 */
export interface UpdateTaskParams {
  task_id: number;
  status?: TaskStatus;
  priority?: Priority;
  title?: string;
  description?: string;
}

/**
 * Brain API action parameters for query-tasks
 */
export interface QueryTasksParams {
  status?: TaskStatus | TaskStatus[];
  priority?: Priority | Priority[];
  project_id?: number;
  goal_id?: number;
  limit?: number;
}

/**
 * Suggested Brain API action
 */
export interface SuggestedAction {
  /** Brain API action name */
  action: string;

  /** Action parameters */
  params: CreateGoalParams | CreateTaskParams | UpdateTaskParams | QueryTasksParams | Record<string, unknown>;

  /** Confidence in this suggestion */
  confidence: number;
}

/**
 * API Request for /api/intent/recognize
 */
export interface RecognizeIntentRequest {
  /** Natural language input text */
  text: string;

  /** Optional context to improve recognition */
  context?: {
    /** Current project context */
    currentProject?: string | number;

    /** Current goal context */
    currentGoal?: string | number;

    /** Recently mentioned task IDs */
    recentTasks?: number[];
  };

  /** Minimum confidence threshold (0-1) */
  confidenceThreshold?: number;
}

/**
 * API Response for /api/intent/recognize
 */
export interface RecognizeIntentResponse {
  /** Whether the request was successful */
  success: boolean;

  /** Intent recognition result */
  result?: IntentRecognitionResult;

  /** Suggested Brain API action (if applicable) */
  suggestedAction?: SuggestedAction;

  /** Error message (if success is false) */
  error?: string;

  /** Error details (if success is false) */
  details?: string;
}

/**
 * Task creation context from intent
 */
export interface TaskFromIntent {
  title: string;
  description: string;
  priority: Priority;
}

/**
 * Project creation context from intent
 */
export interface ProjectFromIntent {
  name: string;
  description: string;
}
