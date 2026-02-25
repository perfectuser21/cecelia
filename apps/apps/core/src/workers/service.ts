/**
 * Workers 服务层 - 匹配 N8N 工作流 (后端版本)
 */

import { Worker, getDepartments, getAllWorkers, getWorkerById, getStats } from './config.js';

// N8N 工作流类型（简化版）
interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

// 匹配到的工作流
interface MatchedWorkflow {
  id: string;
  name: string;
  active: boolean;
  abilityId: string;
  abilityName: string;
}

// 带工作流的员工
interface WorkerWithWorkflows extends Worker {
  departmentId: string;
  departmentName: string;
  matchedWorkflows: MatchedWorkflow[];
}

// N8N API 配置
const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

// 获取 N8N 工作流列表
async function fetchN8nWorkflows(): Promise<N8nWorkflow[]> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (N8N_API_KEY) {
      headers['X-N8N-API-KEY'] = N8N_API_KEY;
    }

    const response = await fetch(`${N8N_API_URL}/api/v1/workflows`, { headers });
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { data?: N8nWorkflow[] };
    return data.data || [];
  } catch {
    return [];
  }
}

// 匹配工作流到员工能力
function matchWorkflowsToWorker(
  worker: Worker & { departmentId: string; departmentName: string },
  workflows: N8nWorkflow[]
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
export async function getWorkersData(): Promise<{
  success: boolean;
  data: {
    departments: ReturnType<typeof getDepartments>;
    totalWorkers: number;
    totalAbilities: number;
  };
}> {
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
export async function getWorkerDetail(workerId: string): Promise<{
  success: boolean;
  data: WorkerWithWorkflows | null;
}> {
  const worker = getWorkerById(workerId);
  if (!worker) {
    return { success: false, data: null };
  }

  try {
    const workflows = await fetchN8nWorkflows();
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
export async function getWorkerWorkflows(workerId: string): Promise<{
  success: boolean;
  data: {
    worker: Worker;
    workflows: MatchedWorkflow[];
  } | null;
}> {
  const worker = getWorkerById(workerId);
  if (!worker) {
    return { success: false, data: null };
  }

  try {
    const workflows = await fetchN8nWorkflows();
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
