// Workers 类型定义 - 统一 AI 员工系统

// 能力（对应 N8N 工作流）
export interface WorkerAbility {
  id: string;
  name: string;
  description: string;
  n8nKeywords: string[]; // 匹配 N8N 工作流的关键词
}

// 员工
export interface Worker {
  id: string;
  name: string;
  alias?: string; // 中文别名
  icon: string; // Lucide icon name
  role: string;
  description: string;
  abilities: WorkerAbility[];
  gradient: {
    from: string;
    to: string;
  };
  status?: 'active' | 'standby' | 'planned';
}

// 部门
export interface Department {
  id: string;
  name: string;
  icon: string;
  description: string;
  workers: Worker[];
}

// 配置文件结构
export interface WorkersConfig {
  $schema?: string;
  version: string;
  departments: Department[];
}

// 带 N8N 工作流的员工
export interface WorkerWithWorkflows extends Worker {
  departmentId: string;
  departmentName: string;
  matchedWorkflows: MatchedWorkflow[];
}

// 匹配到的 N8N 工作流
export interface MatchedWorkflow {
  id: string;
  name: string;
  active: boolean;
  abilityId: string;
  abilityName: string;
}

// API 响应类型
export interface WorkersResponse {
  success: boolean;
  data: {
    departments: Department[];
    totalWorkers: number;
    totalAbilities: number;
  };
}

export interface WorkerDetailResponse {
  success: boolean;
  data: WorkerWithWorkflows | null;
}

export interface WorkerWorkflowsResponse {
  success: boolean;
  data: {
    worker: Worker;
    workflows: MatchedWorkflow[];
  } | null;
}
