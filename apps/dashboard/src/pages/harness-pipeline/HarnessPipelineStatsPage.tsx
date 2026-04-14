/**
 * HarnessPipelineStatsPage — Pipeline 统计仪表盘
 * 路由：/pipeline/stats
 *
 * 展示最近 30 天的 pipeline 运行统计：
 * - completion_rate（完成率）
 * - avg_gan_rounds（平均 GAN 轮次）
 * - avg_duration（平均耗时 ms）
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineStats {
  period_days: number;
  total_pipelines: number;
  completed_pipelines: number;
  completion_rate: number;
  avg_gan_rounds: number;
  avg_duration: number;
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-5 bg-white dark:bg-slate-900/50">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HarnessPipelineStatsPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetch('/api/brain/harness/stats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PipelineStats = await res.json();
        setStats(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/pipeline')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          &larr; Pipeline 列表
        </button>
      </div>

      <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
        Pipeline 统计
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        最近 30 天运行数据
      </p>

      {loading && !stats && (
        <div className="flex items-center gap-2 text-slate-500">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          加载中...
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="完成率 (completion_rate)"
            value={`${Math.round(stats.completion_rate * 100)}%`}
            sub={`${stats.completed_pipelines} / ${stats.total_pipelines} 条 pipeline`}
          />
          <StatCard
            label="平均 GAN 轮次 (avg_gan_rounds)"
            value={stats.avg_gan_rounds > 0 ? `${stats.avg_gan_rounds} 轮` : '—'}
            sub="每条 pipeline 平均 Propose 次数"
          />
          <StatCard
            label="平均耗时 (avg_duration)"
            value={formatDurationMs(stats.avg_duration)}
            sub="从创建到完成"
          />
          <StatCard
            label="总 Pipeline 数"
            value={String(stats.total_pipelines)}
            sub={`近 ${stats.period_days} 天`}
          />
        </div>
      )}
    </div>
  );
}
