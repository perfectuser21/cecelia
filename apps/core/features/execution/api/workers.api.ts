// Workers API 客户端 - 前端调用

import {
  WorkersResponse,
  WorkerDetailResponse,
  WorkerWorkflowsResponse,
  Department,
  Worker,
  WorkerWithWorkflows,
  MatchedWorkflow,
} from '../types';

const API_BASE = (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_URL) || '';

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const workersApi = {
  // 获取所有部门和员工
  getAll: (): Promise<WorkersResponse> => {
    return fetchApi('/api/workers');
  },

  // 获取员工详情（含匹配的工作流）
  getWorker: (workerId: string): Promise<WorkerDetailResponse> => {
    return fetchApi(`/api/workers/${workerId}`);
  },

  // 获取员工匹配的工作流
  getWorkerWorkflows: (workerId: string): Promise<WorkerWorkflowsResponse> => {
    return fetchApi(`/api/workers/${workerId}/workflows`);
  },
};

// 导出类型供组件使用
export type {
  Department,
  Worker,
  WorkerWithWorkflows,
  MatchedWorkflow,
  WorkersResponse,
  WorkerDetailResponse,
  WorkerWorkflowsResponse,
};
