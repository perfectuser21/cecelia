import { apiClient } from './client';

// Types for Observability System (v1.1.1)

export interface RunEvent {
  id: string;
  task_id: string | null;
  run_id: string;
  span_id: string;
  parent_span_id: string | null;
  layer: 'L0_orchestrator' | 'L1_brain' | 'L2_executor' | 'L3_browser' | 'L4_artifact';
  step_name: string;
  status: 'queued' | 'running' | 'blocked' | 'retrying' | 'success' | 'failed' | 'canceled';
  reason_code: string | null;
  reason_kind: 'TRANSIENT' | 'PERSISTENT' | 'RESOURCE' | 'CONFIG' | 'UNKNOWN' | null;
  executor_host: 'us-vps' | 'hk-vps' | 'mac-mini' | 'node-pc' | string;
  agent: string | null;
  region: 'us' | 'hk' | null;
  attempt: number;
  ts_start: string;
  ts_end: string | null;
  heartbeat_ts: string | null;
  input_summary: any;
  output_summary: any;
  artifacts: Record<string, string> | null;
  metadata: any;
}

export interface ActiveRun {
  run_id: string;
  task_id: string | null;
  last_span_id: string;
  layer: string;
  step_name: string;
  status: string;
  executor_host: string;
  ts_start: string;
  heartbeat_ts: string | null;
  seconds_since_activity: number;
}

export interface FailureStats {
  reason_code: string;
  reason_kind: string;
  count: number;
  last_occurred: string;
  example_run_id: string;
}

export interface StuckRun {
  run_id: string;
  task_id: string | null;
  last_alive_span_id: string;
  layer: string;
  step_name: string;
  executor_host: string;
  stuck_duration_seconds: number;
  input_summary: any;
  artifacts: any;
}

export interface Artifact {
  id: string;
  artifact_type: 'screenshot' | 'log' | 'video' | 'dump' | 'report';
  file_path: string;
  file_size: number;
  mime_type: string;
  metadata: any;
  created_at: string;
}

// API functions
export const observabilityApi = {
  // Active Runs
  getActiveRuns: () =>
    apiClient.get<{ success: boolean; data: ActiveRun[]; count: number }>('/brain/trace/runs/active'),

  // Run Details
  getRun: (runId: string) =>
    apiClient.get<{ success: boolean; data: RunEvent[] }>(`/brain/trace/runs/${runId}`),

  // Last Alive Timestamp
  getLastAlive: (runId: string) =>
    apiClient.get<{ success: boolean; data: { last_alive: string; seconds_ago: number } }>(`/brain/trace/runs/${runId}/last-alive`),

  // Top Failures
  getTopFailures: (limit: number = 10) =>
    apiClient.get<{ success: boolean; data: FailureStats[] }>('/brain/trace/failures/top', { params: { limit } }),

  // Stuck Runs Detection
  getStuckRuns: () =>
    apiClient.get<{ success: boolean; data: StuckRun[] }>('/brain/trace/stuck'),

  // Artifact Viewer
  getArtifact: (artifactId: string) =>
    apiClient.get<{ success: boolean; artifact: Artifact; content: any }>(`/brain/trace/artifacts/${artifactId}`),

  // Artifact Download
  downloadArtifact: (artifactId: string) =>
    apiClient.get(`/brain/trace/artifacts/${artifactId}/download`, { responseType: 'blob' }),
};
