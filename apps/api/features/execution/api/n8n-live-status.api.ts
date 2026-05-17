// N8n Live Status API client

const API_BASE = (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_URL) || '';

export type N8nInstance = 'cloud' | 'local';

export interface N8nExecutionNode {
  name: string;
  type: string;
  duration?: number;
  startTime?: string;
  endTime?: string;
  status?: 'success' | 'error' | 'running' | 'waiting';
}

export interface N8nExecutionDetail {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'crashed';
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  finished: boolean;
  duration?: number;
  nodes?: N8nExecutionNode[];
  errorMessage?: string;
}

export interface RunningExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  duration: number;
  currentNode?: string;
}

export interface TodayStats {
  running: number;
  success: number;
  error: number;
  total: number;
  successRate: number;
}

export interface LiveStatusOverview {
  todayStats: TodayStats;
  runningExecutions: RunningExecution[];
  recentCompleted: N8nExecutionDetail[];
  timestamp: number;
}

export interface InstanceStatus {
  available: boolean;
  name: string;
}

export interface InstancesStatus {
  cloud: InstanceStatus;
  local: InstanceStatus;
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const n8nLiveStatusApi = {
  getInstancesStatus: (): Promise<InstancesStatus> => {
    return fetchApi('/api/v1/n8n-live-status/instances/status');
  },

  getLiveStatusOverview: (instance: N8nInstance): Promise<LiveStatusOverview> => {
    return fetchApi(`/api/v1/n8n-live-status/instances/${instance}/overview`);
  },

  getExecutionDetail: (instance: N8nInstance, executionId: string): Promise<N8nExecutionDetail> => {
    return fetchApi(`/api/v1/n8n-live-status/instances/${instance}/executions/${executionId}`);
  },
};
