/**
 * HarnessPipelinePage — Harness Pipeline 可视化
 * 路由：/pipeline
 *
 * 展示每个 planner 任务为一张卡片，内部显示：
 * Planner → Propose (R1/R2/R3) → Review → Generate → Evaluate → Report
 */

import { useState, useEffect, useCallback } from 'react';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface BrainTask {
  id: string;
  title: string;
  status: string;
  task_type: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  pr_url: string | null;
  payload: Record<string, unknown> | null;
  error_message: string | null;
}

type StepStatus = 'completed' | 'in_progress' | 'failed' | 'queued' | 'skipped';

interface PipelineStep {
  key: string;
  label: string;
  status: StepStatus;
  tasks: BrainTask[];
  round?: number;
  verdict?: string;
  pr_url?: string | null;
  duration_ms?: number | null;
}

interface PipelineCard {
  planner: BrainTask;
  steps: PipelineStep[];
  allSubTasks: BrainTask[];
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  harness_planner: 'Planner',
  harness_contract_propose: 'Propose',
  harness_contract_reviewer: 'Review',
  harness_generator: 'Generate',
  harness_evaluator: 'Evaluate',
  harness_report: 'Report',
};

const STATUS_ICON: Record<StepStatus, string> = {
  completed: '✅',
  in_progress: '🔄',
  failed: '❌',
  queued: '⏳',
  skipped: '—',
};

const STATUS_COLOR: Record<StepStatus, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  failed: 'text-red-600 dark:text-red-400',
  queued: 'text-amber-600 dark:text-amber-400',
  skipped: 'text-slate-400 dark:text-slate-500',
};

const STATUS_BG: Record<StepStatus, string> = {
  completed: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
  in_progress: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
  failed: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
  queued: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
  skipped: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function mapTaskStatus(status: string): StepStatus {
  switch (status) {
    case 'completed': return 'completed';
    case 'in_progress': return 'in_progress';
    case 'failed': return 'failed';
    case 'queued':
    case 'pending': return 'queued';
    default: return 'queued';
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function calcDuration(task: BrainTask): number | null {
  if (!task.started_at || !task.completed_at) return null;
  return new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 7) return `${diffD} 天前`;

  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildPipelineSteps(planner: BrainTask, subTasks: BrainTask[]): PipelineStep[] {
  const plannerStep: PipelineStep = {
    key: 'planner',
    label: 'Planner',
    status: mapTaskStatus(planner.status),
    tasks: [planner],
    duration_ms: calcDuration(planner),
    pr_url: planner.pr_url,
  };

  const byType: Record<string, BrainTask[]> = {};
  for (const t of subTasks) {
    if (!byType[t.task_type]) byType[t.task_type] = [];
    byType[t.task_type].push(t);
  }

  const proposeTasks = (byType['harness_contract_propose'] || []).sort((a, b) => {
    const ra = (a.payload?.propose_round as number) || 0;
    const rb = (b.payload?.propose_round as number) || 0;
    return ra - rb;
  });

  const maxRound = proposeTasks.length > 0
    ? Math.max(...proposeTasks.map(t => (t.payload?.propose_round as number) || 1))
    : 0;

  let proposeStatus: StepStatus = 'queued';
  if (proposeTasks.length > 0) {
    const statuses = proposeTasks.map(t => t.status);
    if (statuses.some(s => s === 'in_progress')) proposeStatus = 'in_progress';
    else if (statuses.some(s => s === 'failed')) proposeStatus = 'failed';
    else if (statuses.every(s => s === 'completed')) proposeStatus = 'completed';
    else proposeStatus = 'in_progress';
  }

  const proposeStep: PipelineStep = {
    key: 'propose',
    label: maxRound > 1 ? `Propose (${maxRound}轮)` : 'Propose',
    status: proposeStatus,
    tasks: proposeTasks,
    round: maxRound,
    duration_ms: proposeTasks.reduce((acc, t) => acc + (calcDuration(t) || 0), 0) || null,
  };

  const reviewTasks = byType['harness_contract_reviewer'] || [];
  const lastReview = reviewTasks[0] || null;
  const reviewStep: PipelineStep = {
    key: 'review',
    label: 'Review',
    status: lastReview ? mapTaskStatus(lastReview.status) : 'queued',
    tasks: reviewTasks,
    verdict: lastReview ? (lastReview.payload?.verdict as string) || undefined : undefined,
    duration_ms: lastReview ? calcDuration(lastReview) : null,
  };

  const genTasks = byType['harness_generator'] || [];
  const lastGen = genTasks[0] || null;
  const genStep: PipelineStep = {
    key: 'generate',
    label: 'Generate',
    status: lastGen ? mapTaskStatus(lastGen.status) : 'queued',
    tasks: genTasks,
    pr_url: lastGen?.pr_url || null,
    duration_ms: lastGen ? calcDuration(lastGen) : null,
  };

  const evalTasks = byType['harness_evaluator'] || [];
  const lastEval = evalTasks[0] || null;
  const evalStep: PipelineStep = {
    key: 'evaluate',
    label: 'Evaluate',
    status: lastEval ? mapTaskStatus(lastEval.status) : 'queued',
    tasks: evalTasks,
    verdict: lastEval ? (lastEval.payload?.verdict as string) || undefined : undefined,
    duration_ms: lastEval ? calcDuration(lastEval) : null,
  };

  const reportTasks = byType['harness_report'] || [];
  const lastReport = reportTasks[0] || null;
  const reportStep: PipelineStep = {
    key: 'report',
    label: 'Report',
    status: lastReport ? mapTaskStatus(lastReport.status) : 'queued',
    tasks: reportTasks,
    pr_url: lastReport?.pr_url || null,
    duration_ms: lastReport ? calcDuration(lastReport) : null,
  };

  return [plannerStep, proposeStep, reviewStep, genStep, evalStep, reportStep];
}

// ─── 组件：单步骤徽章 ─────────────────────────────────────────────────────────

function StepBadge({ step }: { step: PipelineStep }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${STATUS_BG[step.status]}`}>
      <span>{STATUS_ICON[step.status]}</span>
      <span className={`font-medium ${STATUS_COLOR[step.status]}`}>{step.label}</span>
      {step.verdict && (
        <span className={`ml-1 font-semibold ${
          step.verdict === 'APPROVED'
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-amber-700 dark:text-amber-400'
        }`}>
          {step.verdict}
        </span>
      )}
      {step.duration_ms != null && step.duration_ms > 0 && (
        <span className="text-slate-400 dark:text-slate-500">
          {formatDuration(step.duration_ms)}
        </span>
      )}
      {step.pr_url && (
        <a
          href={step.pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline ml-1"
          onClick={e => e.stopPropagation()}
        >
          PR
        </a>
      )}
    </div>
  );
}

// ─── 组件：Pipeline 卡片 ──────────────────────────────────────────────────────

function HarnessPipelineCard({ card }: { card: PipelineCard }) {
  const [expanded, setExpanded] = useState(false);
  const { planner, steps } = card;

  const overallStatus = mapTaskStatus(planner.status);
  const stepsDone = steps.filter(s => s.status === 'completed').length;
  const hasFailed = steps.some(s => s.status === 'failed');
  const plannerDuration = calcDuration(planner);

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 shadow-sm overflow-hidden transition-all duration-200 ${
      hasFailed ? 'border-red-200 dark:border-red-800' :
      overallStatus === 'completed' ? 'border-emerald-200 dark:border-emerald-800' :
      overallStatus === 'in_progress' ? 'border-blue-200 dark:border-blue-800' :
      'border-slate-200 dark:border-slate-700'
    }`}>
      <div
        className="flex items-start justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-lg mt-0.5 shrink-0">{STATUS_ICON[overallStatus]}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-snug line-clamp-2">
              {planner.title}
            </h3>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatRelativeTime(planner.created_at)}
              </span>
              {plannerDuration != null && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  总耗时 {formatDuration(plannerDuration)}
                </span>
              )}
              <span className={`text-xs font-medium ${STATUS_COLOR[overallStatus]}`}>
                {stepsDone}/{steps.length} 步完成
              </span>
            </div>
          </div>
        </div>
        <span className="text-slate-400 dark:text-slate-500 ml-3 shrink-0 text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {steps.map(step => (
            <StepBadge key={step.key} step={step} />
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            子任务详情
          </div>
          <div className="space-y-1.5">
            {steps.map(step => (
              <div key={step.key}>
                {step.tasks.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 py-0.5">
                    <span>—</span>
                    <span>{step.label}（暂无任务）</span>
                  </div>
                ) : (
                  step.tasks.map(task => {
                    const taskDuration = calcDuration(task);
                    return (
                      <div key={task.id} className="flex items-center gap-2 text-xs py-0.5">
                        <span>{STATUS_ICON[mapTaskStatus(task.status)]}</span>
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {STEP_LABELS[task.task_type] || task.task_type}
                          {(task.payload?.propose_round as number) ? ` R${task.payload?.propose_round}` : ''}
                        </span>
                        <span className={STATUS_COLOR[mapTaskStatus(task.status)]}>
                          {task.status}
                        </span>
                        {taskDuration != null && (
                          <span className="text-slate-400 dark:text-slate-500">
                            {formatDuration(taskDuration)}
                          </span>
                        )}
                        {(task.payload?.verdict as string) && (
                          <span className={`font-semibold ${
                            (task.payload?.verdict as string) === 'APPROVED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}>
                            {task.payload?.verdict as string}
                          </span>
                        )}
                        {task.pr_url && (
                          <a
                            href={task.pr_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            PR ↗
                          </a>
                        )}
                        {task.error_message && (
                          <span
                            className="text-red-500 dark:text-red-400 truncate max-w-xs"
                            title={task.error_message}
                          >
                            {task.error_message.substring(0, 60)}...
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-400 dark:text-slate-500 font-mono">
            ID: {planner.id}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 主页面组件 ───────────────────────────────────────────────────────────────

export default function HarnessPipelinePage() {
  const [pipelines, setPipelines] = useState<PipelineCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/tasks?task_type=harness_planner&limit=10');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const plannerList: BrainTask[] = await res.json();

      const pipelineCards = await Promise.all(
        plannerList.map(async (planner) => {
          const subTaskTypes = [
            'harness_contract_propose',
            'harness_contract_reviewer',
            'harness_generator',
            'harness_evaluator',
            'harness_report',
          ];

          const subTaskResults = await Promise.all(
            subTaskTypes.map(tt =>
              fetch(`/api/brain/tasks?task_type=${tt}&planner_task_id=${planner.id}&limit=20`)
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
            )
          );

          const allSubTasks: BrainTask[] = subTaskResults.flat();
          const steps = buildPipelineSteps(planner, allSubTasks);
          return { planner, steps, allSubTasks };
        })
      );

      setPipelines(pipelineCards);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchPipelines, 15_000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchPipelines]);

  const stats = {
    total: pipelines.length,
    completed: pipelines.filter(p => p.planner.status === 'completed').length,
    inProgress: pipelines.filter(p => p.planner.status === 'in_progress').length,
    failed: pipelines.filter(p => p.planner.status === 'failed').length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Harness Pipeline
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            GAN 对抗流水线运行状态 · 最近 10 次
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            自动刷新
          </label>
          <button
            onClick={fetchPipelines}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: '总计', value: stats.total, color: 'text-slate-700 dark:text-slate-200' },
          { label: '已完成', value: stats.completed, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: '进行中', value: stats.inProgress, color: 'text-blue-600 dark:text-blue-400' },
          { label: '失败', value: stats.failed, color: 'text-red-600 dark:text-red-400' },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-center"
          >
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        最后更新：{lastRefresh.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 mb-4">
          <p className="text-sm text-red-700 dark:text-red-400">加载失败：{error}</p>
          <p className="text-xs text-red-500 mt-1">
            请确认 Brain API (localhost:5221) 正在运行
          </p>
        </div>
      )}

      {loading && pipelines.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pipelines.length === 0 && !error && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <div className="text-4xl mb-3">🔬</div>
          <p className="text-sm">暂无 Harness Pipeline 记录</p>
        </div>
      )}

      <div className="space-y-3">
        {pipelines.map(card => (
          <HarnessPipelineCard key={card.planner.id} card={card} />
        ))}
      </div>
    </div>
  );
}
