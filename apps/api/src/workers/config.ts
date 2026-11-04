/**
 * Workers 配置加载 (后端版本)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 类型定义
export interface WorkerAbility {
  id: string;
  name: string;
  description: string;
  n8nKeywords: string[];
}

export interface Worker {
  id: string;
  name: string;
  alias?: string;
  icon: string;
  role: string;
  description: string;
  abilities?: WorkerAbility[];
  gradient: {
    from: string;
    to: string;
  };
  status?: 'active' | 'standby' | 'planned';
}

export interface Department {
  id: string;
  name: string;
  icon: string;
  description: string;
  workers: Worker[];
}

export interface WorkersConfig {
  $schema?: string;
  version: string;
  departments?: Department[];
  teams?: Department[];
}

// 加载配置文件
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPaths = [
  join(__dirname, '../../../../packages/workflows/staff/workers.config.json'),
  join(__dirname, '../data/workers/workers.config.json'),
];

export class WorkersConfigUnavailableError extends Error {
  readonly code = 'WORKERS_CONFIG_UNAVAILABLE';
  constructor() { super('员工目录配置不可用'); }
}

let workersConfig: WorkersConfig | null = null;
try {
  const configPath = configPaths.find(path => existsSync(path));
  if (!configPath) throw new WorkersConfigUnavailableError();
  const value = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkersConfig;
  const departments = value?.teams ?? value?.departments;
  if (typeof value?.version !== 'string' || !Array.isArray(departments)
      || departments.some(dept => !dept || typeof dept.id !== 'string' || !Array.isArray(dept.workers)
        || dept.workers.some(worker => !worker || typeof worker.id !== 'string' || (worker.abilities !== undefined && !Array.isArray(worker.abilities))))) {
    throw new WorkersConfigUnavailableError();
  }
  workersConfig = value;
} catch {
  console.error('员工目录配置缺失或损坏，目录接口将返回不可用');
}

function requireWorkersConfig(): WorkersConfig {
  if (!workersConfig) throw new WorkersConfigUnavailableError();
  return workersConfig;
}

// 获取所有部门 (supports both v2 "departments" and v3 "teams" format)
export function getDepartments(): Department[] {
  const config = requireWorkersConfig();
  return config.teams || config.departments || [];
}

// 获取所有员工（扁平化）
export function getAllWorkers(): (Worker & { departmentId: string; departmentName: string })[] {
  const workers: (Worker & { departmentId: string; departmentName: string })[] = [];

  for (const dept of getDepartments()) {
    for (const worker of (dept.workers || [])) {
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
  for (const dept of getDepartments()) {
    const worker = (dept.workers || []).find((w) => w.id === workerId);
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
  for (const ability of (worker.abilities || [])) {
    keywords.push(...(ability.n8nKeywords || []));
  }
  return keywords;
}

// 根据工作流名称匹配员工
export function matchWorkerByWorkflowName(
  workflowName: string
): { worker: Worker; ability: WorkerAbility; departmentId: string } | null {
  const lowerName = workflowName.toLowerCase();

  for (const dept of getDepartments()) {
    for (const worker of (dept.workers || [])) {
      for (const ability of (worker.abilities || [])) {
        for (const keyword of (ability.n8nKeywords || [])) {
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
  return requireWorkersConfig().version;
}

// 统计信息
export function getStats(): { totalDepartments: number; totalWorkers: number; totalAbilities: number } {
  let totalWorkers = 0;
  let totalAbilities = 0;

  for (const dept of getDepartments()) {
    totalWorkers += (dept.workers || []).length;
    for (const worker of (dept.workers || [])) {
      totalAbilities += (worker.abilities || []).length;
    }
  }

  return {
    totalDepartments: getDepartments().length,
    totalWorkers,
    totalAbilities,
  };
}
