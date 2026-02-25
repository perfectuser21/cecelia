// Workers 服务层 - 匹配 N8N 工作流

import {
  Worker,
  WorkerWithWorkflows,
  MatchedWorkflow,
  WorkersResponse,
  WorkerDetailResponse,
  WorkerWorkflowsResponse,
} from './workers.types';
import {
  getDepartments,
  getAllWorkers,
  getWorkerById,
  getStats,
} from './workers.config';
import { n8nWorkflowsApi, N8nWorkflowWithStats } from '../api/n8n-workflows.api';

// 匹配工作流到员工能力
function matchWorkflowsToWorker(
  worker: Worker & { departmentId: string; departmentName: string },
  workflows: N8nWorkflowWithStats[]
): MatchedWorkflow[] {
  const matched: MatchedWorkflow[] = [];

  for (const ability of worker.abilities) {
    for (const workflow of workflows) {
      const workflowNameLower = workflow.name.toLowerCase();
      for (const keyword of ability.n8nKeywords) {
        if (workflowNameLower.includes(keyword.toLowerCase())) {
          // 避免重复
          if (!matched.some((m) => m.id === workflow.id)) {
            matched.push({
              id: workflow.id,
              name: workflow.name,
              active: workflow.active,
              abilityId: ability.id,
              abilityName: ability.name,
            });
          }
          break;
        }
      }
    }
  }

  return matched;
}

// 获取所有员工（用于 API）
export async function getWorkersData(): Promise<WorkersResponse> {
  const departments = getDepartments();
  const stats = getStats();

  return {
    success: true,
    data: {
      departments,
      totalWorkers: stats.totalWorkers,
      totalAbilities: stats.totalAbilities,
    },
  };
}

// 获取员工详情（含匹配的工作流）
export async function getWorkerDetail(workerId: string): Promise<WorkerDetailResponse> {
  const worker = getWorkerById(workerId);
  if (!worker) {
    return { success: false, data: null };
  }

  try {
    // 获取 N8N 工作流
    const workflowStats = await n8nWorkflowsApi.getWorkflowsByInstance('local');
    const workflows = workflowStats.workflows || [];

    // 匹配工作流
    const matchedWorkflows = matchWorkflowsToWorker(worker, workflows);

    const result: WorkerWithWorkflows = {
      ...worker,
      matchedWorkflows,
    };

    return { success: true, data: result };
  } catch {
    // N8N 不可用时返回空工作流列表
    const result: WorkerWithWorkflows = {
      ...worker,
      matchedWorkflows: [],
    };
    return { success: true, data: result };
  }
}

// 获取员工匹配的工作流
export async function getWorkerWorkflows(workerId: string): Promise<WorkerWorkflowsResponse> {
  const worker = getWorkerById(workerId);
  if (!worker) {
    return { success: false, data: null };
  }

  try {
    const workflowStats = await n8nWorkflowsApi.getWorkflowsByInstance('local');
    const workflows = workflowStats.workflows || [];
    const matchedWorkflows = matchWorkflowsToWorker(worker, workflows);

    return {
      success: true,
      data: {
        worker,
        workflows: matchedWorkflows,
      },
    };
  } catch {
    return {
      success: true,
      data: {
        worker,
        workflows: [],
      },
    };
  }
}

// 根据工作流名称找到对应的员工和能力
export function findWorkerByWorkflowName(
  workflowName: string
): { worker: Worker; abilityId: string; abilityName: string; departmentId: string; departmentName: string } | null {
  const workers = getAllWorkers();
  const lowerName = workflowName.toLowerCase();

  for (const worker of workers) {
    for (const ability of worker.abilities) {
      for (const keyword of ability.n8nKeywords) {
        if (lowerName.includes(keyword.toLowerCase())) {
          return {
            worker,
            abilityId: ability.id,
            abilityName: ability.name,
            departmentId: worker.departmentId,
            departmentName: worker.departmentName,
          };
        }
      }
    }
  }

  return null;
}
