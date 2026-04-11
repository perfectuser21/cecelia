/**
 * Harness Pipeline API Client
 */

import { apiClient } from './client';

export type HarnessVerdict = 'pending' | 'in_progress' | 'passed' | 'failed' | 'completed' | string;
export type HarnessStageStatus = 'not_started' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'canceled' | 'quarantined' | string;

export interface HarnessStage {
  id?: string;
  task_type: string;
  label: string;
  status: HarnessStageStatus;
  title?: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
  error_message?: string | null;
  pr_url?: string | null;
}

export interface HarnessPipeline {
  sprint_dir: string;
  title: string;
  sprint_goal: string;
  verdict: HarnessVerdict;
  current_step: string | null;
  elapsed_ms: number;
  created_at: string;
  stages: HarnessStage[];
}

export interface HarnessPipelinesResponse {
  pipelines: HarnessPipeline[];
  total: number;
}

export async function getHarnessPipelines(params?: {
  limit?: number;
  status?: string;
}): Promise<HarnessPipelinesResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString() ? `?${qs}` : '';
  const res = await apiClient.get(`/brain/harness-pipelines${query}`);
  return res.data;
}

// ─── Pipeline Detail Types ──────────────────────────────────────────────────

export interface GanRoundPropose {
  task_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  verdict: string | null;
  propose_round: number;
}

export interface GanRoundReview {
  task_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  verdict: string | null;
  feedback: string | null;
  contract_branch: string | null;
}

export interface GanRound {
  round: number;
  propose: GanRoundPropose | null;
  review: GanRoundReview | null;
}

export interface PipelineDetailStage {
  task_type: string;
  label: string;
  status: HarnessStageStatus;
  task_id: string | null;
  title: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  pr_url: string | null;
  result: Record<string, unknown> | null;
  count: number;
}

export interface PipelineDetailResponse {
  planner_task_id: string;
  title: string;
  description: string;
  user_input: string;
  sprint_dir: string;
  status: string;
  created_at: string | null;
  stages: PipelineDetailStage[];
  gan_rounds: GanRound[];
  file_contents: Record<string, string | null>;
}

export async function getHarnessPipelineDetail(
  plannerTaskId: string
): Promise<PipelineDetailResponse> {
  const res = await apiClient.get(`/brain/harness/pipeline-detail?planner_task_id=${encodeURIComponent(plannerTaskId)}`);
  return res.data;
}
