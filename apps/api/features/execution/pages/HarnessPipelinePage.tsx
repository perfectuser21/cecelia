/**
 * HarnessPipelinePage — Harness Pipeline 可视化页面
 * 展示每条 pipeline 的 propose→review→generate→report 流转状态
 */

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  Loader2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import { getHarnessPipelines, type HarnessPipeline, type HarnessStage, type HarnessStageStatus } from '../api/harness-pipeline.api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  });
}

// ─── Verdict Badge ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  passed:      { label: '通过', bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  failed:      { label: '失败', bg: 'bg-red-500/15',     text: 'text-red-600 dark:text-red-400',         dot: 'bg-red-500' },
  in_progress: { label: '进行中', bg: 'bg-blue-500/15',  text: 'text-blue-600 dark:text-blue-400',        dot: 'bg-blue-500 animate-pulse' },
  pending:     { label: '等待中', bg: 'bg-slate-400/15', text: 'text-slate-500 dark:text-slate-400',       dot: 'bg-slate-400' },
  completed:   { label: '完成', bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400',  dot: 'bg-emerald-500' },
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Stage Status Icon ───────────────────────────────────────────────────────

function StageIcon({ status }: { status: HarnessStageStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'failed':
    case 'canceled':
    case 'quarantined':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'in_progress':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case 'queued':
      return <Clock className="w-4 h-4 text-amber-400" />;
    case 'not_started':
    default:
      return <Circle className="w-4 h-4 text-slate-400/50" />;
  }
}

// ─── Stage Flow Bar ──────────────────────────────────────────────────────────

const STAGE_STATUS_COLOR: Record<string, string> = {
  completed:   'bg-emerald-500',
  failed:      'bg-red-500',
  canceled:    'bg-red-400',
  quarantined: 'bg-orange-400',
  in_progress: 'bg-blue-500',
  queued:      'bg-amber-400',
  not_started: 'bg-slate-200 dark:bg-slate-700',
};

function StageFlowBar({ stages }: { stages: HarnessStage[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, idx) => (
        <div key={stage.task_type} className="flex items-center gap-1">
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={`h-2 w-8 rounded-full ${STAGE_STATUS_COLOR[stage.status] || 'bg-slate-300'}`}
              title={`${stage.label}: ${stage.status}`}
            />
            <span className="text-[9px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              {stage.label}
            </span>
          </div>
          {idx < stages.length - 1 && (
            <div className="w-3 h-px bg-slate-300 dark:bg-slate-600 mb-3" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Pipeline Card ───────────────────────────────────────────────────────────

function PipelineCard({ pipeline }: { pipeline: HarnessPipeline }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      >
        <span className="mt-1 text-slate-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {pipeline.title}
            </span>
            <VerdictBadge verdict={pipeline.verdict} />
            {pipeline.current_step && (
              <span className="text-xs text-blue-500 dark:text-blue-400">
                → {pipeline.current_step}
              </span>
            )}
          </div>

          {pipeline.sprint_goal && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {pipeline.sprint_goal}
            </p>
          )}

          <div className="flex items-center gap-4 mt-2">
            <StageFlowBar stages={pipeline.stages} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatTime(pipeline.created_at)}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatElapsed(pipeline.elapsed_ms)}
          </span>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700/50 px-5 py-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {pipeline.sprint_dir}
            </span>
          </div>

          {pipeline.stages.map((stage) => (
            <StageDetail key={stage.task_type} stage={stage} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stage Detail Row ────────────────────────────────────────────────────────

function StageDetail({ stage }: { stage: HarnessStage }) {
  if (stage.status === 'not_started') {
    return (
      <div className="flex items-center gap-3 py-1.5 opacity-40">
        <StageIcon status={stage.status} />
        <span className="text-xs text-slate-500 dark:text-slate-400">{stage.label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-1.5">
      <StageIcon status={stage.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {stage.label}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            stage.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
            stage.status === 'failed' ? 'bg-red-500/15 text-red-500' :
            stage.status === 'in_progress' ? 'bg-blue-500/15 text-blue-500' :
            stage.status === 'queued' ? 'bg-amber-500/15 text-amber-500' :
            'bg-slate-400/15 text-slate-500'
          }`}>
            {stage.status}
          </span>
          {stage.pr_url && (
            <a
              href={stage.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:underline"
              onClick={e => e.stopPropagation()}
            >
              PR <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
        {stage.error_message && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate">{stage.error_message}</p>
        )}
        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 flex gap-3">
          {stage.started_at && <span>开始 {formatTime(stage.started_at)}</span>}
          {stage.completed_at && <span>完成 {formatTime(stage.completed_at)}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HarnessPipelinePage() {
  const [pipelines, setPipelines] = useState<HarnessPipeline[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPipelines = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await getHarnessPipelines({ limit: 20 });
      setPipelines(data.pipelines);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipelines');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
    const interval = setInterval(() => fetchPipelines(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchPipelines]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Harness Pipeline</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Pipeline 流转状态 — propose → review → generate → report
          </p>
        </div>
        <button
          onClick={() => fetchPipelines(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Stats Bar */}
      {!loading && pipelines.length > 0 && (
        <div className="flex gap-4 text-sm">
          {(['passed', 'failed', 'in_progress', 'pending'] as const).map(v => {
            const count = pipelines.filter(p => p.verdict === v).length;
            if (count === 0) return null;
            const cfg = VERDICT_CONFIG[v];
            return (
              <span key={v} className={`inline-flex items-center gap-1.5 ${cfg.text}`}>
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.label} {count}
              </span>
            );
          })}
          <span className="text-slate-400 dark:text-slate-500">共 {total} 条</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            <p className="text-sm text-slate-500">加载 Pipeline 数据...</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-500 text-sm">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && pipelines.length === 0 && (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">
          <Circle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无 Harness Pipeline 记录</p>
          <p className="text-xs mt-1 text-slate-400">启动一次 Harness 后这里会显示流转状态</p>
        </div>
      )}

      {/* Pipeline List */}
      {!loading && !error && pipelines.length > 0 && (
        <div className="space-y-3">
          {pipelines.map(pipeline => (
            <PipelineCard key={pipeline.sprint_dir} pipeline={pipeline} />
          ))}
        </div>
      )}
    </div>
  );
}
