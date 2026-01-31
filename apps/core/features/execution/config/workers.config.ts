// Workers 配置加载

import { WorkersConfig, Department, Worker, WorkerAbility } from './workers.types';
import workersConfigJson from '../../../data/workers/workers.config.json';

// 加载配置
const workersConfig = workersConfigJson as WorkersConfig;

// 获取所有部门
export function getDepartments(): Department[] {
  return workersConfig.departments;
}

// 获取所有员工（扁平化）
export function getAllWorkers(): (Worker & { departmentId: string; departmentName: string })[] {
  const workers: (Worker & { departmentId: string; departmentName: string })[] = [];

  for (const dept of workersConfig.departments) {
    for (const worker of dept.workers) {
      workers.push({
        ...worker,
        departmentId: dept.id,
        departmentName: dept.name,
      });
    }
  }

  return workers;
}

// 根据 ID 获取员工
export function getWorkerById(
  workerId: string
): (Worker & { departmentId: string; departmentName: string }) | null {
  for (const dept of workersConfig.departments) {
    const worker = dept.workers.find((w) => w.id === workerId);
    if (worker) {
      return {
        ...worker,
        departmentId: dept.id,
        departmentName: dept.name,
      };
    }
  }
  return null;
}

// 获取员工的所有能力关键词
export function getWorkerKeywords(workerId: string): string[] {
  const worker = getWorkerById(workerId);
  if (!worker) return [];

  const keywords: string[] = [];
  for (const ability of worker.abilities) {
    keywords.push(...ability.n8nKeywords);
  }
  return keywords;
}

// 根据工作流名称匹配员工
export function matchWorkerByWorkflowName(
  workflowName: string
): { worker: Worker; ability: WorkerAbility; departmentId: string } | null {
  const lowerName = workflowName.toLowerCase();

  for (const dept of workersConfig.departments) {
    for (const worker of dept.workers) {
      for (const ability of worker.abilities) {
        for (const keyword of ability.n8nKeywords) {
          if (lowerName.includes(keyword.toLowerCase())) {
            return {
              worker,
              ability,
              departmentId: dept.id,
            };
          }
        }
      }
    }
  }

  return null;
}

// 获取配置版本
export function getConfigVersion(): string {
  return workersConfig.version;
}

// 统计信息
export function getStats(): { totalDepartments: number; totalWorkers: number; totalAbilities: number } {
  let totalWorkers = 0;
  let totalAbilities = 0;

  for (const dept of workersConfig.departments) {
    totalWorkers += dept.workers.length;
    for (const worker of dept.workers) {
      totalAbilities += worker.abilities.length;
    }
  }

  return {
    totalDepartments: workersConfig.departments.length,
    totalWorkers,
    totalAbilities,
  };
}
