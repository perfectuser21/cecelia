// Runs API client - 执行历史

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface RunExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'error' | 'running' | 'waiting' | 'crashed';
  startedAt: string;
  stoppedAt?: string;
  duration?: number;
  mode?: string;
  finished: boolean;
  errorMessage?: string;
}

export interface RunsOverview {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  runningRuns: number;
  overallSuccessRate: number;
  executions: RunExecution[];
  timestamp: number;
}

export interface RunsStats {
  total: number;
  success: number;
  error: number;
  running: number;
  crashed: number;
  successRate: number;
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const runsApi = {
  // 获取执行历史概览
  getOverview: (params?: {
    status?: string;
    limit?: number;
    workflowId?: string;
  }): Promise<RunsOverview> => {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.workflowId) queryParams.append('workflowId', params.workflowId);

    const queryString = queryParams.toString();
    const endpoint = `/api/v1/runs${queryString ? `?${queryString}` : ''}`;
    return fetchApi(endpoint);
  },

  // 获取单个执行详情
  getRunDetails: (runId: string): Promise<RunExecution> => {
    return fetchApi(`/api/v1/runs/${runId}`);
  },

  // 获取统计数据
  getStats: (workflowId?: string): Promise<RunsStats> => {
    const endpoint = workflowId
      ? `/api/v1/runs/stats?workflowId=${workflowId}`
      : '/api/v1/runs/stats';
    return fetchApi(endpoint);
  },
};
