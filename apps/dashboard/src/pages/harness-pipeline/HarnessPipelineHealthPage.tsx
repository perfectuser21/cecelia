/**
 * HarnessPipelineHealthPage — Harness Pipeline 健康监控
 * 路由：/harness-pipeline/health
 *
 * 展示所有活跃 pipeline 的健康状态：
 * - 容器状态和资源用量
 * - 卡住的 pipeline（>6h 无进展）高亮显示
 * - 失败率趋势汇总
 * - 自动刷新（30s）
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineHealth {
  pipeline_id: string;
  title: string;
  status: string;
  sprint_dir: string;
  pipeline_stuck: boolean;
  last_activity: string | null;
  created_at: string | null;
  failed_tasks: number;
  total_tasks: number;
}

interface PipelineHealthResponse {
  pipelines: PipelineHealth[];
  failure_rate: number;
  stuck_count: number;
  total_active: number;
  generated_at: string;
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  return `${diffD} 天前`;
}

function getStuckDuration(lastActivity: string | null): string {
  if (!lastActivity) return '';
  const diffMs = Date.now() - new Date(lastActivity).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  return diffH > 0 ? `${diffH}h ${diffM}m 无进展` : `${diffM}m 无进展`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HarnessPipelineHealthPage() {
  const [data, setData] = useState<PipelineHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await fetch('/api/brain/harness/pipeline-health');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json: PipelineHealthResponse = await resp.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // 30s 自动刷新
  useEffect(() => {
    const timer = setInterval(fetchHealth, 30_000);
    return () => clearInterval(timer);
  }, [fetchHealth]);

  // ─── Loading ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-5">
          <p className="text-red-600 dark:text-red-400 font-medium">加载失败</p>
          <p className="text-red-500 dark:text-red-500 text-sm mt-1">{error}</p>
          <button
            onClick={fetchHealth}
            className="mt-3 px-4 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const pipelines = data?.pipelines ?? [];
  const failureRate = data?.failure_rate ?? 0;
  const stuckCount = data?.stuck_count ?? 0;

  // ─── Empty State ──────────────────────────────────────────────────────────

  const emptyState = pipelines.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Harness Pipeline 健康监控</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            活跃 Pipeline 状态 · 自动刷新（30s）
            {lastRefresh && <span className="ml-2">· 更新于 {formatRelativeTime(lastRefresh.toISOString())}</span>}
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          刷新
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">活跃 Pipeline</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{data?.total_active ?? 0}</p>
        </div>
        <div className={`border rounded-xl p-4 ${stuckCount > 0 ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">卡住 Pipeline</p>
          <p className={`text-2xl font-bold ${stuckCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
            {stuckCount}
          </p>
        </div>
        <div className={`border rounded-xl p-4 ${failureRate > 0.2 ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">24h 失败率</p>
          <p className={`text-2xl font-bold ${failureRate > 0.2 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
            {(failureRate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Pipeline List */}
      {emptyState ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center">
          <p className="text-slate-400 dark:text-slate-500 text-sm">暂无活跃 Pipeline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.pipeline_id}
              className={`bg-white dark:bg-slate-800 border rounded-xl p-4 transition-colors ${
                pipeline.pipeline_stuck
                  ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {pipeline.pipeline_stuck && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-medium rounded-full border border-red-200 dark:border-red-700">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        STUCK
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      pipeline.status === 'in_progress'
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                      {pipeline.status}
                    </span>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-white text-sm truncate">
                    {pipeline.title || '(无标题)'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {pipeline.sprint_dir}
                  </p>
                </div>

                <div className="text-right flex-shrink-0 space-y-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    最后活跃：{formatRelativeTime(pipeline.last_activity)}
                  </p>
                  {pipeline.pipeline_stuck && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      ⚠ {getStuckDuration(pipeline.last_activity)}
                    </p>
                  )}
                  {pipeline.total_tasks > 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      失败 {pipeline.failed_tasks}/{pipeline.total_tasks} 任务
                    </p>
                  )}
                </div>
              </div>

              {/* Stuck 警告详情 */}
              {pipeline.pipeline_stuck && (
                <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    该 Pipeline 已超过 6 小时无进展，请检查是否存在阻塞任务或资源不足。
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
