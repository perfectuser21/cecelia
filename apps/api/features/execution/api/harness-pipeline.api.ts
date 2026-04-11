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
