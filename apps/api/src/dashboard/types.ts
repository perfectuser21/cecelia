/**
 * Dashboard-specific types
 * Extends shared types with API-specific interfaces
 */

import type { TaskRun, CheckpointProgress, DashboardOverview } from '../shared/types.js';

// Re-export shared types
export type { TaskRun, CheckpointProgress, DashboardOverview };

// ============ API Request/Response Types ============

export interface CreateRunRequest {
  prd_path: string;
  project: string;
  feature_branch: string;
  total_checkpoints: number;
}

export interface CreateRunResponse {
  success: boolean;
  run_id: string;
  run: TaskRun;
}

export interface UpdateCheckpointRequest {
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  pr_url?: string;
  duration?: number;
}

export interface UpdateCheckpointResponse {
  success: boolean;
  checkpoint: CheckpointProgress;
}

export interface GetRunResponse {
  success: boolean;
  run: TaskRun;
  checkpoints: CheckpointProgress[];
}

export interface GetOverviewResponse extends DashboardOverview {
  success: boolean;
}

export interface ErrorResponse {
  success: false;
  error: string;
}

// ============ Internal Store Types ============

export interface RunStore {
  runs: Map<string, TaskRun>;
  checkpoints: Map<string, CheckpointProgress[]>;
}
