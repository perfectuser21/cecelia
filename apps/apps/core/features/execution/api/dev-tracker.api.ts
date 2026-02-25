/**
 * Dev Task Tracker API
 * 开发任务追踪 API 调用
 */

import { apiClient } from './client';

// Types
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
export type CIStatus = 'pending' | 'running' | 'passed' | 'failed' | 'unknown';
export type BranchType = 'main' | 'develop' | 'feature' | 'cp' | 'unknown';

export interface StepItem {
  id: number;
  name: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface DevTaskStatus {
  repo: { name: string; path: string; remoteUrl: string };
  branches: { main: string; develop: string; feature: string | null; current: string; type: BranchType };
  task: { name: string; createdAt: string; prNumber: number | null; prUrl: string | null; prState: 'open' | 'closed' | 'merged' | null };
  steps: { current: number; total: number; items: StepItem[] };
  quality: { ci: CIStatus; codex: CIStatus; lastCheck: string };
  updatedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
}

// API Functions

/**
 * 获取健康状态
 */
export async function getHealth(): Promise<ApiResponse<{ status: string; trackedRepos: string[] }>> {
  const response = await apiClient.get('/dev/health');
  return response.data;
}

/**
 * 获取单个仓库状态
 */
export async function getRepoStatus(repo: string): Promise<ApiResponse<DevTaskStatus>> {
  const response = await apiClient.get(`/dev/status?repo=${encodeURIComponent(repo)}`);
  return response.data;
}

/**
 * 获取所有活跃任务
 */
export async function getAllTasks(): Promise<ApiResponse<DevTaskStatus[]>> {
  const response = await apiClient.get('/dev/tasks');
  return response.data;
}

/**
 * 更新步骤状态
 */
export async function updateStepStatus(
  repo: string,
  step: number,
  status: StepStatus
): Promise<ApiResponse<StepItem>> {
  const response = await apiClient.post('/dev/status', { repo, step, status });
  return response.data;
}

/**
 * 重置仓库步骤
 */
export async function resetSteps(repo: string, taskName?: string): Promise<ApiResponse<void>> {
  const response = await apiClient.post('/dev/reset', { repo, taskName });
  return response.data;
}

/**
 * 获取追踪的仓库列表
 */
export async function getTrackedRepos(): Promise<ApiResponse<string[]>> {
  const response = await apiClient.get('/dev/repos');
  return response.data;
}
