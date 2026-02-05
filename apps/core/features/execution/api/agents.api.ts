// Cecelia Agents API - 获取 Cecelia（无头 Claude Code）任务状态

import { CECELIA_AGENTS, CeceliaAgent, matchAgentByWorkflow } from '../config/agents.config';

const API_BASE = import.meta.env.VITE_API_URL || '';
const BRAIN_API_URL = '/api/brain';

// ============ Cluster Status Types ============

export interface ServerStatus {
  online: boolean;
  cpu_cores: number;
  cpu_load: number;
  mem_total_gb: number;
  mem_free_gb: number;
  slots_max: number;
  slots_available: number;
  slots_in_use: number;
  tasks_running: string[];
  danger_level?: 'normal' | 'warning' | 'danger' | 'critical';
}

export interface ClusterStatus {
  servers: {
    us: ServerStatus;
    hk: ServerStatus;
  };
  cluster_status: 'healthy' | 'partial' | 'degraded';
  total_slots: number;
  available_slots: number;
  recommendation: string;
}

// 获取集群状态
export async function fetchClusterStatus(): Promise<ClusterStatus | null> {
  try {
    const response = await fetch(`${BRAIN_API_URL}/cluster/status`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export type TimeRange = '24h' | '72h' | '7d';

// 步骤状态
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

// 任务步骤
export interface TaskStep {
  id: number;
  name: string;
  status: StepStatus;
  started_at?: string;
  completed_at?: string;
}

// Checkpoint 详情（层级显示）
export interface CheckpointDetail {
  id: string;                    // CP-001, CP-002, etc.
  name: string;                  // Checkpoint 名称
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  dev_steps?: TaskStep[];        // 9 步 dev 流程详情
}

// Cecelia 任务（Claude Code 执行）
export interface CeceliaRun {
  id: string;
  prd_path: string;
  project: string;  // repository
  feature_branch: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  total_checkpoints: number;
  completed_checkpoints: number;
  failed_checkpoints: number;
  started_at: string;
  updated_at: string;
  // 扩展字段
  mode?: 'headless' | 'interactive';  // 有头/无头
  current_checkpoint?: string;  // 当前步骤名
  // 实时追踪字段
  current_action?: string;       // 当前正在做什么
  current_step?: number;         // 当前步骤索引 (1-9)
  steps?: TaskStep[];            // 步骤详情
  pr_url?: string;               // PR 链接
  // 详情字段（层级显示）
  repo_url?: string;             // GitHub 仓库 URL
  prd_title?: string;            // PRD 标题
  prd_summary?: string;          // PRD 目的摘要
  checkpoints_detail?: CheckpointDetail[];  // Checkpoint 详情列表
}

// Cecelia 概览
export interface CeceliaTaskOverview {
  total_runs: number;
  running: number;
  completed: number;
  failed: number;
  recent_runs: CeceliaRun[];
}

// N8N 执行（调度 Cecelia 的工作流）
export interface N8nExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
  duration?: number;
}

export interface AgentStats {
  todayTotal: number;
  todaySuccess: number;
  todayError: number;
  todayRunning: number;
  successRate: number;
}

export interface PeriodStats {
  total: number;
  success: number;
  error: number;
  running: number;
  successRate: number;
}

export interface AgentWithStats extends CeceliaAgent {
  stats: AgentStats;
  recentRuns: CeceliaRun[];
}

export interface CeceliaOverview {
  // Cecelia 任务统计
  totalRuns: number;
  runningRuns: number;
  completedRuns: number;
  failedRuns: number;
  // 正在运行的 Cecelia 任务
  runningTasks: CeceliaRun[];
  // 最近完成的任务
  recentRuns: CeceliaRun[];
  // 时间范围统计
  timeRange: TimeRange;
  periodStats: PeriodStats;
  // Agent 信息（可选）
  agents: AgentWithStats[];
}

// 获取 Cecelia 任务概览
async function fetchCeceliaTaskOverview(): Promise<CeceliaTaskOverview | null> {
  try {
    const response = await fetch(`${API_BASE}/api/cecelia/overview?limit=20`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (!data.success) {
      return null;
    }
    return data as CeceliaTaskOverview;
  } catch {
    return null;
  }
}

// 获取 N8N 工作流状态（用于显示调度状态）
async function fetchN8nStatus(): Promise<{ runningExecutions: N8nExecution[]; recentCompleted: N8nExecution[] } | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/n8n-live-status/instances/local/overview`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return {
      runningExecutions: data.runningExecutions || [],
      recentCompleted: data.recentCompleted || [],
    };
  } catch {
    return null;
  }
}

// 时间范围转换为毫秒
function getTimeRangeMillis(timeRange: TimeRange): number {
  switch (timeRange) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '72h':
      return 72 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

// 根据时间范围过滤任务
function filterRunsByTimeRange(runs: CeceliaRun[], timeRange: TimeRange): CeceliaRun[] {
  const now = Date.now();
  const rangeMillis = getTimeRangeMillis(timeRange);
  const cutoff = now - rangeMillis;

  return runs.filter((run) => {
    const startTime = new Date(run.started_at).getTime();
    return startTime >= cutoff;
  });
}

// 计算时间范围内的统计
function calculatePeriodStats(runs: CeceliaRun[], timeRange: TimeRange): PeriodStats {
  const filteredRuns = filterRunsByTimeRange(runs, timeRange);

  const completed = filteredRuns.filter((r) => r.status === 'completed').length;
  const failed = filteredRuns.filter((r) => r.status === 'failed').length;
  const running = filteredRuns.filter((r) => r.status === 'running').length;
  const total = filteredRuns.length;
  const finished = completed + failed;

  return {
    total,
    success: completed,
    error: failed,
    running,
    successRate: finished > 0 ? Math.round((completed / finished) * 100) : 0,
  };
}

// 按 Agent 聚合任务
function aggregateRunsByAgent(runs: CeceliaRun[]): Map<string, CeceliaRun[]> {
  const agentRuns = new Map<string, CeceliaRun[]>();

  // 初始化所有 Agent
  for (const agent of CECELIA_AGENTS) {
    agentRuns.set(agent.id, []);
  }

  // 根据 project/branch 匹配 Agent
  for (const run of runs) {
    // 简单匹配：所有任务都归到 Spark (执行者)
    const sparkRuns = agentRuns.get('spark') || [];
    sparkRuns.push(run);
    agentRuns.set('spark', sparkRuns);
  }

  return agentRuns;
}

// 计算 Agent 统计
function calculateAgentStats(runs: CeceliaRun[]): AgentStats {
  const today = new Date().toDateString();
  const todayRuns = runs.filter((r) => new Date(r.started_at).toDateString() === today);

  const todayCompleted = todayRuns.filter((r) => r.status === 'completed').length;
  const todayFailed = todayRuns.filter((r) => r.status === 'failed').length;
  const todayRunning = todayRuns.filter((r) => r.status === 'running').length;
  const todayTotal = todayRuns.length;
  const todayFinished = todayCompleted + todayFailed;

  return {
    todayTotal,
    todaySuccess: todayCompleted,
    todayError: todayFailed,
    todayRunning,
    successRate: todayFinished > 0 ? Math.round((todayCompleted / todayFinished) * 100) : 0,
  };
}

export async function fetchCeceliaOverview(timeRange: TimeRange = '24h'): Promise<CeceliaOverview> {
  // 获取 Cecelia 任务数据
  const ceceliaData = await fetchCeceliaTaskOverview();

  const allRuns = ceceliaData?.recent_runs || [];

  // 分离运行中和已完成的任务
  const runningTasks = allRuns.filter((r) => r.status === 'running');
  const recentRuns = allRuns.filter((r) => r.status !== 'running').slice(0, 10);

  // 计算时间范围内的统计
  const periodStats = calculatePeriodStats(allRuns, timeRange);

  // 按 Agent 聚合
  const agentRunsMap = aggregateRunsByAgent(allRuns);

  // 构建 Agent 列表（带统计）
  const agentsWithStats: AgentWithStats[] = CECELIA_AGENTS.map((agent) => {
    const runs = agentRunsMap.get(agent.id) || [];
    const stats = calculateAgentStats(runs);
    return {
      ...agent,
      stats,
      recentRuns: runs.slice(0, 5),
    };
  });

  return {
    totalRuns: ceceliaData?.total_runs || 0,
    runningRuns: ceceliaData?.running || 0,
    completedRuns: ceceliaData?.completed || 0,
    failedRuns: ceceliaData?.failed || 0,
    runningTasks,
    recentRuns,
    timeRange,
    periodStats,
    agents: agentsWithStats,
  };
}

export async function fetchAgentDetail(agentId: string, timeRange: TimeRange = '24h'): Promise<AgentWithStats | null> {
  const overview = await fetchCeceliaOverview(timeRange);
  return overview.agents.find((a) => a.id === agentId) || null;
}

// ============ Timeline View Types ============

// Feature 历史版本
export interface FeatureVersion {
  id: string;           // run id
  version: number;      // 版本号 (1, 2, 3...)
  date: string;         // 日期
  status: CeceliaRun['status'];
  branch: string;       // 完整分支名
}

// Feature (聚合同一功能的多次修改)
export interface FeatureGroup {
  name: string;                    // Feature 名称 (从 branch 提取)
  displayName: string;             // 显示名称
  history: FeatureVersion[];       // 历史版本
  current?: CeceliaRun;            // 当前运行中的任务
  latestRun: CeceliaRun;           // 最新的 run
}

// Project (按仓库分组)
export interface ProjectGroup {
  name: string;                    // 项目名 (zenithjoy-core, etc.)
  repoUrl?: string;                // GitHub URL
  features: FeatureGroup[];        // Features
  runningCount: number;            // 运行中的任务数
  totalRuns: number;               // 总任务数
}

// Timeline 视图数据
export interface TimelineData {
  projects: ProjectGroup[];
  totalProjects: number;
  totalFeatures: number;
  totalRuns: number;
}

// 从分支名提取 Feature 名称
function extractFeatureName(branch: string): string {
  // cp-cecelia-timeline-ui → cecelia
  // cp-01191435-cecelia-agents → cecelia
  // feature/add-login → add-login

  let name = branch
    .replace(/^cp-/, '')           // 移除 cp- 前缀
    .replace(/^feature\//, '')     // 移除 feature/ 前缀
    .replace(/^\d{6,}-/, '')       // 移除日期前缀 (如 01191435-)
    .replace(/-v\d+$/, '')         // 移除版本后缀 (如 -v2)
    .split('-')[0];                // 取第一个词作为 feature 名

  return name || branch;
}

// Feature 名称格式化显示
function formatFeatureName(name: string): string {
  // cecelia → Cecelia
  // timeline-ui → Timeline UI
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// 按 Project 和 Feature 聚合 runs
function aggregateByProjectAndFeature(runs: CeceliaRun[]): ProjectGroup[] {
  const projectMap = new Map<string, Map<string, CeceliaRun[]>>();

  // 按 project → feature 分组
  for (const run of runs) {
    const project = run.project || 'unknown';
    const featureName = extractFeatureName(run.feature_branch);

    if (!projectMap.has(project)) {
      projectMap.set(project, new Map());
    }

    const featureMap = projectMap.get(project)!;
    if (!featureMap.has(featureName)) {
      featureMap.set(featureName, []);
    }

    featureMap.get(featureName)!.push(run);
  }

  // 构建 ProjectGroup 数组
  const projects: ProjectGroup[] = [];

  for (const [projectName, featureMap] of projectMap) {
    const features: FeatureGroup[] = [];
    let projectRunningCount = 0;
    let projectTotalRuns = 0;

    for (const [featureName, featureRuns] of featureMap) {
      // 按时间排序（旧 → 新）
      const sortedRuns = [...featureRuns].sort(
        (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      );

      // 构建历史版本
      const history: FeatureVersion[] = sortedRuns.map((run, index) => ({
        id: run.id,
        version: index + 1,
        date: new Date(run.started_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        status: run.status,
        branch: run.feature_branch,
      }));

      // 找当前运行中的
      const current = sortedRuns.find(r => r.status === 'running');
      const latestRun = sortedRuns[sortedRuns.length - 1];

      features.push({
        name: featureName,
        displayName: formatFeatureName(featureName),
        history,
        current,
        latestRun,
      });

      projectRunningCount += current ? 1 : 0;
      projectTotalRuns += sortedRuns.length;
    }

    // 按是否有运行中任务排序，然后按最新时间排序
    features.sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return new Date(b.latestRun.started_at).getTime() - new Date(a.latestRun.started_at).getTime();
    });

    // 获取 repo URL (从第一个有 repo_url 的 run)
    const repoUrl = runs.find(r => r.project === projectName && r.repo_url)?.repo_url;

    projects.push({
      name: projectName,
      repoUrl,
      features,
      runningCount: projectRunningCount,
      totalRuns: projectTotalRuns,
    });
  }

  // 按运行中任务数排序，然后按总任务数
  projects.sort((a, b) => {
    if (a.runningCount !== b.runningCount) return b.runningCount - a.runningCount;
    return b.totalRuns - a.totalRuns;
  });

  return projects;
}

// 获取 Timeline 视图数据
export async function fetchTimelineData(): Promise<TimelineData> {
  const ceceliaData = await fetchCeceliaTaskOverview();
  const allRuns = ceceliaData?.recent_runs || [];

  const projects = aggregateByProjectAndFeature(allRuns);

  return {
    projects,
    totalProjects: projects.length,
    totalFeatures: projects.reduce((sum, p) => sum + p.features.length, 0),
    totalRuns: allRuns.length,
  };
}
