/**
 * HarnessPipelinePage — Harness Pipeline 可视化
 * 路由：/pipeline
 *
 * 使用 GET /api/brain/harness-pipelines 聚合端点（单次请求）
 * 按 sprint_dir 分组，展示 6 步流水线状态
 */

import { useState, useEffect, useCallback } from 'react';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface PipelineStage {
  id?: string;
  task_type: string;
  label: string;
  status: string;
  title?: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  pr_url?: string | null;
}

interface Pipeline {
  sprint_dir: string;
  title: string;
  sprint_goal?: string;
  verdict: string;
  current_step: string | null;
  elapsed_ms?: number;
  created_at: string;
  stages: PipelineStage[];
}

interface HarnessPipelinesResponse {
  pipelines: Pipeline[];
  total: number;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: '✅',
  in_progress: '🔄',
  failed: '❌',
  queued: '⏳',
  not_started: '—',
  canceled: '🚫',
  quarantined: '🔒',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  failed: 'text-red-600 dark:text-red-400',
  queued: 'text-amber-600 dark:text-amber-400',
  not_started: 'text-slate-400 dark:text-slate-500',
  canceled: 'text-slate-500 dark:text-slate-400',
  quarantined: 'text-orange-600 dark:text-orange-400',
};

const STATUS_BG: Record<string, string> = {
  completed: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
  in_progress: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
  failed: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
  queued: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
  not_started: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
  canceled: 'bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700',
  quarantined: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
};

const VERDICT_COLOR: Record<string, string> = {
  passed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  pending: 'text-slate-500 dark:text-slate-400',
};

const VERDICT_LABEL: Record<string, string> = {
  passed: '已通过',
  failed: '失败',
  in_progress: '进行中',
  pending: '待开始',
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mrem = m % 60;
  return mrem > 0 ? `${h}h${mrem}m` : `${h}h`;
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

function normalizeStatus(status: string): string {
  return status in STATUS_ICON ? status : 'not_started';
}

// ─── 组件：单阶段徽章 ─────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: PipelineStage }) {
  const s = normalizeStatus(stage.status);
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${STATUS_BG[s] ?? STATUS_BG.not_started}`}>
      <span>{STATUS_ICON[s] ?? '—'}</span>
      <span className={`font-medium ${STATUS_COLOR[s] ?? STATUS_COLOR.not_started}`}>
        {stage.label}
      </span>
      {stage.pr_url && (
        <a
          href={stage.pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700 dark:text-blue-400 underline ml-1"
          onClick={e => e.stopPropagation()}
        >
          PR
        </a>
      )}
    </div>
  );
}

// ─── 组件：Pipeline 卡片 ──────────────────────────────────────────────────────

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  const [expanded, setExpanded] = useState(false);
  const { stages, verdict, elapsed_ms, created_at, sprint_goal, current_step, title } = pipeline;

  const completedCount = stages.filter(s => s.status === 'completed').length;
  const hasFailed = stages.some(s => ['failed', 'quarantined'].includes(s.status));

  const borderColor = hasFailed
    ? 'border-red-200 dark:border-red-800'
    : verdict === 'passed'
      ? 'border-emerald-200 dark:border-emerald-800'
      : verdict === 'in_progress'
        ? 'border-blue-200 dark:border-blue-800'
        : 'border-slate-200 dark:border-slate-700';

  const overallIcon = hasFailed ? '❌' : verdict === 'passed' ? '✅' : verdict === 'in_progress' ? '🔄' : '⏳';

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 shadow-sm overflow-hidden transition-all duration-200 ${borderColor}`}>
      {/* 头部 */}
      <div
        className="flex items-start justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-lg mt-0.5 shrink-0">{overallIcon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-snug line-clamp-2">
              {title}
            </h3>
            {sprint_goal && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{sprint_goal}</p>
            )}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatRelativeTime(created_at)}
              </span>
              {elapsed_ms != null && elapsed_ms > 0 && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  耗时 {formatDuration(elapsed_ms)}
                </span>
              )}
              <span className={`text-xs font-medium ${VERDICT_COLOR[verdict] ?? VERDICT_COLOR.pending}`}>
                {VERDICT_LABEL[verdict] ?? verdict}
              </span>
              {current_step && (
                <span className="text-xs text-blue-500 dark:text-blue-400">
                  当前: {current_step}
                </span>
              )}
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {completedCount}/{stages.length} 步完成
              </span>
            </div>
          </div>
        </div>
        <span className="text-slate-400 dark:text-slate-500 ml-3 shrink-0 text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* 阶段徽章栏 */}
      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {stages.map(stage => (
            <StageBadge key={stage.task_type} stage={stage} />
          ))}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            各阶段详情
          </div>
          <div className="space-y-1.5">
            {stages.map(stage => {
              const s = normalizeStatus(stage.status);
              const stageDuration = stage.started_at && stage.completed_at
                ? new Date(stage.completed_at).getTime() - new Date(stage.started_at).getTime()
                : null;
              return (
                <div key={stage.task_type} className="flex items-center gap-2 text-xs py-0.5">
                  <span>{STATUS_ICON[s] ?? '—'}</span>
                  <span className="text-slate-600 dark:text-slate-300 font-medium w-20 shrink-0">
                    {stage.label}
                  </span>
                  <span className={STATUS_COLOR[s] ?? STATUS_COLOR.not_started}>
                    {stage.status}
                  </span>
                  {stageDuration != null && (
                    <span className="text-slate-400 dark:text-slate-500">
                      {formatDuration(stageDuration)}
                    </span>
                  )}
                  {stage.pr_url && (
                    <a
                      href={stage.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      PR ↗
                    </a>
                  )}
                  {stage.error_message && (
                    <span
                      className="text-red-500 dark:text-red-400 truncate max-w-xs"
                      title={stage.error_message}
                    >
                      {stage.error_message.substring(0, 80)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-slate-400 dark:text-slate-500 font-mono">
            sprint: {pipeline.sprint_dir}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 主页面组件 ───────────────────────────────────────────────────────────────

export default function HarnessPipelinePage() {
  const [data, setData] = useState<HarnessPipelinesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/harness-pipelines?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json: HarnessPipelinesResponse = await res.json();
      setData(json);
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

  const pipelines = data?.pipelines ?? [];

  const stats = {
    total: pipelines.length,
    passed: pipelines.filter(p => p.verdict === 'passed').length,
    inProgress: pipelines.filter(p => p.verdict === 'in_progress').length,
    failed: pipelines.filter(p => p.verdict === 'failed').length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Harness Pipeline
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            GAN 对抗流水线运行状态 · 最近 20 次
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
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

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: '总计', value: stats.total, color: 'text-slate-700 dark:text-slate-200' },
          { label: '已通过', value: stats.passed, color: 'text-emerald-600 dark:text-emerald-400' },
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

      {/* 时间戳 */}
      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        最后更新：{lastRefresh.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}
        {data != null && <span className="ml-2">共 {data.total} 条</span>}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 mb-4">
          <p className="text-sm text-red-700 dark:text-red-400">加载失败：{error}</p>
          <p className="text-xs text-red-500 mt-1">
            请确认 Brain API (localhost:5221) 正在运行
          </p>
        </div>
      )}

      {/* 骨架屏 */}
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

      {/* 空状态 */}
      {!loading && pipelines.length === 0 && !error && (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <div className="text-4xl mb-3">🔬</div>
          <p className="text-sm">暂无 Harness Pipeline 记录</p>
        </div>
      )}

      {/* Pipeline 列表 */}
      <div className="space-y-3">
        {pipelines.map(pipeline => (
          <PipelineCard
            key={`${pipeline.sprint_dir}::${pipeline.created_at}`}
            pipeline={pipeline}
          />
        ))}
      </div>
    </div>
  );
}
