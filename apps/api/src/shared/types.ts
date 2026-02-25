/**
 * Shared type definitions for Cecelia and Dashboard
 * Based on zenithjoy-engine/templates/prd-schema.json
 */

// ============ PRD Types ============

export type PRDStatus = 'draft' | 'approved' | 'in_progress' | 'done' | 'failed';

export interface PRDMeta {
  project: string;
  feature_branch: string;
  created_at?: string;
  status: PRDStatus;
  notion_page_id?: string;
}

export interface PRD {
  meta: PRDMeta;
  background?: string;
  goals?: string[];
  non_goals?: string[];
  checkpoints: Checkpoint[];
}

// ============ Checkpoint Types ============

export type CheckpointType = 'code' | 'test' | 'config' | 'docs' | 'review';
export type CheckpointSize = 'small' | 'medium' | 'large';
export type CheckpointStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface Checkpoint {
  id: string;                       // Format: CP-001, CP-002, etc.
  name: string;
  type: CheckpointType;
  depends_on: string | null;
  size: CheckpointSize;
  description: string;
  dod: string[];                    // Definition of Done
  verify_commands: string[];
  status: CheckpointStatus;
  branch_name?: string | null;      // Format: cp-xxx
  pr_url?: string | null;
  error?: string | null;
  retry_count?: number;
  model?: string;                   // Override default model selection
}

// ============ Execution Types ============

export type ModelType = 'claude-code' | 'codex' | 'gemini';

export interface ExecutionResult {
  success: boolean;
  checkpoint_id: string;
  output?: string;
  duration?: number;                // milliseconds
  tokens_used?: number;
  cost?: number;
  pr_url?: string;
  error?: string;
}

export interface BatchExecutionResult {
  total: number;
  success: number;
  failed: number;
  results: Record<string, ExecutionResult>;
}

// ============ Adapter Types ============

export interface AdapterConfig {
  model: ModelType;
  workdir: string;
  timeout?: number;
}

export interface AdapterResult {
  success: boolean;
  output: string;
  tokens_used?: number;
  cost?: number;
  error?: string;
}

export interface ModelAdapter {
  name: ModelType;
  execute(prompt: string, config: AdapterConfig): Promise<AdapterResult>;
  healthCheck(): Promise<boolean>;
}

// ============ Dashboard Types ============

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskRun {
  id: string;
  prd_path: string;
  project: string;
  feature_branch: string;
  status: RunStatus;
  total_checkpoints: number;
  completed_checkpoints: number;
  failed_checkpoints: number;
  current_checkpoint?: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;
  mode?: 'headless' | 'interactive';  // 有头/无头模式
  // 实时追踪字段
  current_action?: string;           // 当前正在做什么
  current_step?: number;             // 当前步骤索引 (1-9)
  steps?: TaskStep[];                // 步骤详情
  pr_url?: string;                   // PR 链接
  // 详情字段（层级显示）
  repo_url?: string;                 // GitHub 仓库 URL
  prd_title?: string;                // PRD 标题
  prd_summary?: string;              // PRD 目的摘要
  checkpoints_detail?: CheckpointDetail[];  // Checkpoint 详情列表
}

// Checkpoint 详情（用于层级显示）
export interface CheckpointDetail {
  id: string;                        // CP-001, CP-002, etc.
  name: string;                      // Checkpoint 名称
  status: CheckpointStatus;          // pending | in_progress | done | failed
  dev_steps?: TaskStep[];            // 9 步 dev 流程详情
}

export interface TaskStep {
  id: number;
  name: string;
  status: StepStatus;
  started_at?: string;
  completed_at?: string;
}

export interface CheckpointProgress {
  run_id: string;
  checkpoint_id: string;
  status: CheckpointStatus;
  started_at?: string;
  completed_at?: string;
  duration?: number;
  output?: string;
  error?: string;
  pr_url?: string;
}

export interface DashboardOverview {
  total_runs: number;
  running: number;
  completed: number;
  failed: number;
  recent_runs: TaskRun[];
}

// ============ CLI Types ============

export interface CLIOptions {
  prd: string;
  checkpoint?: string;
  all?: boolean;
  model?: ModelType;
  workdir?: string;
  callback?: string;
  health?: boolean;
}

// CLI output format matches ExecutionResult
export type CLIResult = ExecutionResult;

// ============ Exit Codes ============

export const EXIT_CODES = {
  SUCCESS: 0,
  EXECUTION_FAILED: 1,
  INVALID_ARGS: 2,
  PRD_LOAD_FAILED: 3,
  DEPENDENCY_NOT_MET: 4,
} as const;

// ============ Dev Tracker Types ============

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

export const DEV_WORKFLOW_STEPS = [
  { id: 1, name: 'PRD' },
  { id: 2, name: 'Detect' },
  { id: 3, name: 'Branch' },
  { id: 4, name: 'DoD' },
  { id: 5, name: 'Code' },
  { id: 6, name: 'Test' },
  { id: 7, name: 'Quality' },
  { id: 8, name: 'PR' },
  { id: 9, name: 'CI' },
  { id: 10, name: 'Learning' },
  { id: 11, name: 'Cleanup' },
] as const;
