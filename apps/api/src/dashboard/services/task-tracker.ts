/**
 * Task Tracker Service
 * Combines in-memory storage with .dev-runs/ file-based reports
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  TaskRun,
  CheckpointProgress,
  DashboardOverview,
  StepStatus,
  CheckpointDetail,
  CheckpointStatus,
} from '../../shared/types.js';
import { DEV_WORKFLOW_STEPS } from '../../shared/types.js';
import type { CreateRunRequest, UpdateCheckpointRequest } from '../types.js';

// 项目目录列表 - 用于读取 .dev-runs/ 报告
// 通过环境变量配置基础路径，支持 dev/prod 分离
const CODE_BASE = process.env.CODE_BASE_PATH || '/home/xx/dev';
const PROJECT_DIRS = [
  `${CODE_BASE}/zenithjoy-engine`,
  `${CODE_BASE}/cecelia-workspace`,
];

interface DevRunReport {
  task_id: string;
  project: string;
  branch: string;
  base_branch?: string;
  mode?: 'headless' | 'interactive';
  timestamp: string;
  date: string;
  quality_report: {
    L1_automated: 'pass' | 'fail' | 'skip';
    L2_verification: 'pass' | 'fail' | 'skip';
    L3_acceptance: 'pass' | 'fail' | 'skip';
    overall: 'pass' | 'fail';
  };
  ci_cd?: {
    pr_url?: string;
    pr_merged?: boolean;
  };
  version?: string;
  files_changed?: string[];
  // 新增：PRD 详情
  prd_title?: string;
  prd_summary?: string;
  checkpoints?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}

// 解析 PRD 内容提取 checkpoint
function parsePrdCheckpoints(content: string): CheckpointDetail[] {
  const checkpoints: CheckpointDetail[] = [];

  // 匹配类似 "### CP-001: 实现登录页面" 或 "- [ ] CP-001 实现登录页面"
  const cpRegex = /(?:###?\s*)?(CP-\d+)[:\s]+([^\n]+)/gi;
  let match;

  while ((match = cpRegex.exec(content)) !== null) {
    const id = match[1].toUpperCase();
    const name = match[2].trim();

    // 检查是否已完成（有 [x] 或 ✅）
    let status: CheckpointStatus = 'pending';
    if (content.includes(`[x] ${id}`) || content.includes(`✅ ${id}`)) {
      status = 'done';
    }

    checkpoints.push({ id, name, status });
  }

  return checkpoints;
}

// 从 PRD 内容提取标题和摘要
function parsePrdMeta(content: string): { title?: string; summary?: string } {
  const lines = content.split('\n');
  let title: string | undefined;
  let summary: string | undefined;

  for (const line of lines) {
    // 匹配标题：# PRD: xxx 或 # xxx
    if (!title && line.startsWith('#')) {
      const titleMatch = line.match(/^#\s*(?:PRD:\s*)?(.+)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    }

    // 匹配摘要：## 背景 或 ## 目的 后的第一段
    if (!summary && (line.includes('## 背景') || line.includes('## 目的') || line.includes('## 目标'))) {
      const idx = lines.indexOf(line);
      for (let i = idx + 1; i < lines.length; i++) {
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#') && !nextLine.startsWith('-')) {
          summary = nextLine.slice(0, 100); // 截取前 100 字符
          break;
        }
      }
    }

    if (title && summary) break;
  }

  return { title, summary };
}

// 获取 GitHub 仓库 URL
function getRepoUrl(projectDir: string): string | undefined {
  try {
    const gitConfigPath = path.join(projectDir, '.git', 'config');
    if (!fs.existsSync(gitConfigPath)) return undefined;

    const content = fs.readFileSync(gitConfigPath, 'utf-8');
    const match = content.match(/url\s*=\s*(.+)/);
    if (match) {
      let url = match[1].trim();
      // 转换 git@ 格式为 https
      if (url.startsWith('git@')) {
        url = url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
      }
      return url.replace(/\.git$/, '');
    }
  } catch {
    // 忽略
  }
  return undefined;
}

function parseDevRunReport(filePath: string): DevRunReport | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function transformReportToTaskRun(report: DevRunReport, projectDir?: string): TaskRun {
  const qr = report.quality_report;
  let status: TaskRun['status'] = 'completed';
  let failedCheckpoints = 0;
  let completedCheckpoints = 0;
  const totalCheckpoints = 3;

  if (qr.L1_automated === 'pass') completedCheckpoints++;
  else if (qr.L1_automated === 'fail') failedCheckpoints++;

  if (qr.L2_verification === 'pass') completedCheckpoints++;
  else if (qr.L2_verification === 'fail') failedCheckpoints++;

  if (qr.L3_acceptance === 'pass') completedCheckpoints++;
  else if (qr.L3_acceptance === 'fail') failedCheckpoints++;

  if (qr.overall === 'fail' || failedCheckpoints > 0) {
    status = 'failed';
  }

  // 获取 repo URL 和 PRD 详情
  let repoUrl: string | undefined;
  let prdTitle: string | undefined;
  let prdSummary: string | undefined;
  let checkpointsDetail: CheckpointDetail[] | undefined;

  if (projectDir) {
    repoUrl = getRepoUrl(projectDir);

    // 尝试从报告中获取 PRD 信息
    if (report.prd_title) {
      prdTitle = report.prd_title;
      prdSummary = report.prd_summary;
    }

    // 尝试读取 PRD 文件
    const prdPath = path.join(projectDir, '.prd.md');
    if (fs.existsSync(prdPath)) {
      try {
        const content = fs.readFileSync(prdPath, 'utf-8');
        const meta = parsePrdMeta(content);
        if (!prdTitle) prdTitle = meta.title;
        if (!prdSummary) prdSummary = meta.summary;
        checkpointsDetail = parsePrdCheckpoints(content);
      } catch {
        // 忽略
      }
    }

    // 如果报告中有 checkpoints，使用报告中的
    if (report.checkpoints && report.checkpoints.length > 0) {
      checkpointsDetail = report.checkpoints.map((cp) => ({
        id: cp.id,
        name: cp.name,
        status: cp.status as CheckpointStatus,
      }));
    }
  }

  return {
    id: report.task_id,
    prd_path: '',
    project: report.project,
    feature_branch: report.branch,
    status,
    total_checkpoints: totalCheckpoints,
    completed_checkpoints: completedCheckpoints,
    failed_checkpoints: failedCheckpoints,
    started_at: report.timestamp,
    updated_at: report.timestamp,
    mode: report.mode,
    current_checkpoint: undefined,
    // 新增字段
    repo_url: repoUrl,
    prd_title: prdTitle,
    prd_summary: prdSummary,
    checkpoints_detail: checkpointsDetail,
  };
}

function loadDevRunReports(): TaskRun[] {
  const allRuns: TaskRun[] = [];

  for (const projectDir of PROJECT_DIRS) {
    const devRunsDir = path.join(projectDir, '.dev-runs');
    if (!fs.existsSync(devRunsDir)) continue;

    try {
      const files = fs.readdirSync(devRunsDir);
      for (const file of files) {
        if (!file.endsWith('-report.json')) continue;
        const filePath = path.join(devRunsDir, file);
        const report = parseDevRunReport(filePath);
        if (report) {
          allRuns.push(transformReportToTaskRun(report, projectDir));
        }
      }
    } catch {
      // 忽略读取错误
    }
  }

  return allRuns;
}

class TaskTrackerService {
  private runs: Map<string, TaskRun> = new Map();
  private checkpoints: Map<string, CheckpointProgress[]> = new Map();

  /**
   * Create a new task run
   */
  createRun(request: CreateRunRequest): TaskRun {
    const id = uuidv4();
    const now = new Date().toISOString();

    const run: TaskRun = {
      id,
      prd_path: request.prd_path,
      project: request.project,
      feature_branch: request.feature_branch,
      status: 'pending',
      total_checkpoints: request.total_checkpoints,
      completed_checkpoints: 0,
      failed_checkpoints: 0,
      started_at: now,
      updated_at: now,
    };

    this.runs.set(id, run);
    this.checkpoints.set(id, []);

    return run;
  }

  /**
   * Get a task run by ID
   */
  getRun(runId: string): TaskRun | undefined {
    // 先检查内存
    const memoryRun = this.runs.get(runId);
    if (memoryRun) return memoryRun;

    // 再从文件加载
    const fileRuns = loadDevRunReports();
    return fileRuns.find((r) => r.id === runId);
  }

  /**
   * Get all checkpoints for a run
   */
  getCheckpoints(runId: string): CheckpointProgress[] {
    // 内存中的 checkpoints
    const memoryCheckpoints = this.checkpoints.get(runId);
    if (memoryCheckpoints && memoryCheckpoints.length > 0) {
      return memoryCheckpoints;
    }

    // 从文件加载的报告生成 checkpoints
    const run = this.getRun(runId);
    if (!run) return [];

    // 根据 run 的状态生成 checkpoint 信息
    const checkpoints: CheckpointProgress[] = [
      {
        run_id: runId,
        checkpoint_id: 'L1',
        status: run.completed_checkpoints >= 1 ? 'done' : run.failed_checkpoints >= 1 ? 'failed' : 'pending',
        started_at: run.started_at,
        completed_at: run.updated_at,
      },
      {
        run_id: runId,
        checkpoint_id: 'L2',
        status: run.completed_checkpoints >= 2 ? 'done' : run.failed_checkpoints >= 2 ? 'failed' : 'pending',
        started_at: run.started_at,
        completed_at: run.updated_at,
      },
      {
        run_id: runId,
        checkpoint_id: 'L3',
        status: run.completed_checkpoints >= 3 ? 'done' : run.failed_checkpoints >= 3 ? 'failed' : 'pending',
        started_at: run.started_at,
        completed_at: run.updated_at,
      },
    ];

    return checkpoints;
  }

  /**
   * Update checkpoint status
   */
  updateCheckpoint(
    runId: string,
    checkpointId: string,
    update: UpdateCheckpointRequest
  ): CheckpointProgress | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    const checkpointList = this.checkpoints.get(runId) || [];
    let checkpoint = checkpointList.find((cp) => cp.checkpoint_id === checkpointId);

    const now = new Date().toISOString();

    if (!checkpoint) {
      // Create new checkpoint progress
      checkpoint = {
        run_id: runId,
        checkpoint_id: checkpointId,
        status: update.status,
        started_at: update.status === 'in_progress' ? now : undefined,
      };
      checkpointList.push(checkpoint);
      this.checkpoints.set(runId, checkpointList);
    }

    // Update checkpoint
    checkpoint.status = update.status;

    if (update.status === 'in_progress') {
      checkpoint.started_at = checkpoint.started_at || now;
      run.current_checkpoint = checkpointId;
      run.status = 'running';
    }

    if (update.status === 'done' || update.status === 'failed') {
      checkpoint.completed_at = now;
      checkpoint.duration = update.duration;
      checkpoint.output = update.output;
      checkpoint.error = update.error;
      checkpoint.pr_url = update.pr_url;

      if (update.status === 'done') {
        run.completed_checkpoints++;
      } else {
        run.failed_checkpoints++;
        run.error = update.error;
      }

      // Check if run is complete
      if (run.completed_checkpoints + run.failed_checkpoints >= run.total_checkpoints) {
        run.status = run.failed_checkpoints > 0 ? 'failed' : 'completed';
        run.completed_at = now;
        run.current_checkpoint = undefined;
      }
    }

    run.updated_at = now;

    return checkpoint;
  }

  /**
   * Get dashboard overview
   */
  getOverview(limit: number = 10): DashboardOverview {
    // 内存中的运行数据
    const memoryRuns = Array.from(this.runs.values());

    // 从 .dev-runs/ 文件加载的报告
    const fileRuns = loadDevRunReports();

    // 合并并去重（以 id 为准，内存数据优先）
    const runMap = new Map<string, TaskRun>();

    for (const run of fileRuns) {
      runMap.set(run.id, run);
    }

    for (const run of memoryRuns) {
      runMap.set(run.id, run);
    }

    const allRuns = Array.from(runMap.values());

    const running = allRuns.filter((r) => r.status === 'running').length;
    const completed = allRuns.filter((r) => r.status === 'completed').length;
    const failed = allRuns.filter((r) => r.status === 'failed').length;

    // Sort by updated_at desc and take limit
    const recentRuns = allRuns
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);

    return {
      total_runs: allRuns.length,
      running,
      completed,
      failed,
      recent_runs: recentRuns,
    };
  }

  /**
   * Update run's realtime status
   */
  updateRunStatus(
    runId: string,
    update: {
      current_action?: string;
      current_step?: number;
      step_status?: StepStatus;
      pr_url?: string;
    }
  ): TaskRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    const now = new Date().toISOString();

    // Update current action
    if (update.current_action !== undefined) {
      run.current_action = update.current_action;
    }

    // Update PR URL
    if (update.pr_url !== undefined) {
      run.pr_url = update.pr_url;
    }

    // Update current step and steps array
    if (update.current_step !== undefined) {
      run.current_step = update.current_step;

      // Initialize steps if not exists
      if (!run.steps) {
        run.steps = DEV_WORKFLOW_STEPS.map((s) => ({
          id: s.id,
          name: s.name,
          status: 'pending' as StepStatus,
        }));
      }

      // Update step status
      const stepIndex = update.current_step - 1;
      if (stepIndex >= 0 && stepIndex < run.steps.length) {
        const step = run.steps[stepIndex];

        if (update.step_status) {
          step.status = update.step_status;

          if (update.step_status === 'in_progress' && !step.started_at) {
            step.started_at = now;
          }
          if (update.step_status === 'done' || update.step_status === 'failed') {
            step.completed_at = now;
          }
        } else {
          // Default: mark as in_progress
          step.status = 'in_progress';
          if (!step.started_at) {
            step.started_at = now;
          }
        }

        // Mark previous steps as done if not already
        for (let i = 0; i < stepIndex; i++) {
          if (run.steps[i].status === 'pending' || run.steps[i].status === 'in_progress') {
            run.steps[i].status = 'done';
            if (!run.steps[i].completed_at) {
              run.steps[i].completed_at = now;
            }
          }
        }
      }
    }

    run.updated_at = now;
    run.status = 'running';

    return run;
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.runs.clear();
    this.checkpoints.clear();
  }
}

export const taskTracker = new TaskTrackerService();
