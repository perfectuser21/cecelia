import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  GitBranch,
  ChevronRight,
  MonitorPlay,
  Terminal,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState } from '../../shared/components/LoadingState';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { StatsCard } from '../../shared/components/StatsCard';
import { formatRelativeTime } from '../../shared/utils/formatters';
import { getStatusIcon } from '../../shared/utils/statusHelpers';
import { usePollingWithRefresh } from '../../shared/hooks/usePolling';
import type { CeceliaRun, CeceliaTaskOverview } from '../api/agents.api';

const DEV_STEP_NAMES: Record<number, string> = {
  1: 'PRD',
  2: 'Detect',
  3: 'Branch',
  4: 'DoD',
  5: 'Code',
  6: 'Test',
  7: 'Quality',
  8: 'PR',
  9: 'CI',
};

export default function TaskMonitor() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<CeceliaTaskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/cecelia/overview?limit=20');
      const data = await res.json();
      if (data.success) {
        setOverview(data as CeceliaTaskOverview);
        setError(null);
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = usePollingWithRefresh(fetchData, { interval: 5000, immediate: true });

  if (loading && !overview) {
    return <LoadingState height="h-64" message="Loading task monitor..." />;
  }

  if (error && !overview) {
    return (
      <ErrorState
        message={`Cecelia API error: ${error}`}
        onRetry={refresh}
        height="h-64"
      />
    );
  }

  const runs = overview?.recent_runs || [];
  const runningTasks = runs.filter((r) => r.status === 'running');
  const completedCount = overview?.completed || 0;
  const failedCount = overview?.failed || 0;
  const runningCount = overview?.running || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Task Monitor</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Cecelia 执行状态实时监控
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          label="总任务"
          value={overview?.total_runs || 0}
          icon={Clock}
          iconGradient="from-slate-500 to-slate-600"
          iconShadow="shadow-slate-500/25"
        />
        <StatsCard
          label="运行中"
          value={runningCount}
          icon={Activity}
          iconGradient="from-blue-500 to-indigo-600"
          iconShadow="shadow-blue-500/25"
        />
        <StatsCard
          label="已完成"
          value={completedCount}
          icon={CheckCircle2}
          iconGradient="from-emerald-500 to-green-600"
          iconShadow="shadow-emerald-500/25"
        />
        <StatsCard
          label="失败"
          value={failedCount}
          icon={XCircle}
          iconGradient="from-red-500 to-rose-600"
          iconShadow="shadow-red-500/25"
        />
      </div>

      {/* Running Tasks (highlighted) */}
      {runningTasks.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-blue-800">
          <div className="px-6 py-4 border-b border-blue-200 dark:border-blue-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
            <h2 className="font-semibold text-gray-900 dark:text-white">
              运行中 ({runningTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {runningTasks.map((run) => (
              <RunningTaskCard
                key={run.id}
                run={run}
                onClick={() => navigate(`/cecelia/runs/${run.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Tasks */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">最近任务</h2>
        </div>
        {runs.length > 0 ? (
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {runs.map((run) => (
              <TaskRow
                key={run.id}
                run={run}
                onClick={() => navigate(`/cecelia/runs/${run.id}`)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂无任务"
            description="Cecelia 尚未执行任何任务"
            icon={<Clock className="w-12 h-12" />}
          />
        )}
      </div>
    </div>
  );
}

function RunningTaskCard({ run, onClick }: { run: CeceliaRun; onClick: () => void }) {
  const progress = run.total_checkpoints > 0
    ? Math.round((run.completed_checkpoints / run.total_checkpoints) * 100)
    : 0;

  const currentStepName = run.current_step
    ? DEV_STEP_NAMES[run.current_step] || `Step ${run.current_step}`
    : run.current_checkpoint || run.current_action;

  return (
    <div
      onClick={onClick}
      className="p-6 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{run.project}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <GitBranch className="w-3.5 h-3.5" />
              <span>{run.feature_branch}</span>
              {run.mode && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  {run.mode === 'headless' ? (
                    <span className="flex items-center gap-1">
                      <Terminal className="w-3.5 h-3.5 text-purple-400" />
                      无头
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <MonitorPlay className="w-3.5 h-3.5 text-cyan-400" />
                      交互
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="running" showIcon size="sm" />
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {currentStepName ? `当前: ${currentStepName}` : '执行中...'}
          </span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {run.completed_checkpoints}/{run.total_checkpoints} ({progress}%)
          </span>
        </div>
        <div className="h-2.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      {run.steps && run.steps.length > 0 && (
        <div className="flex gap-1">
          {run.steps.map((step) => (
            <div
              key={step.id}
              className={`flex-1 h-1.5 rounded-full ${
                step.status === 'done'
                  ? 'bg-emerald-500'
                  : step.status === 'in_progress'
                  ? 'bg-blue-500 animate-pulse'
                  : step.status === 'failed'
                  ? 'bg-red-500'
                  : 'bg-gray-200 dark:bg-slate-700'
              }`}
              title={`${step.name}: ${step.status}`}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        {formatRelativeTime(run.updated_at)}
      </p>
    </div>
  );
}

function TaskRow({ run, onClick }: { run: CeceliaRun; onClick: () => void }) {
  const progress = run.total_checkpoints > 0
    ? Math.round((run.completed_checkpoints / run.total_checkpoints) * 100)
    : 0;

  return (
    <div
      onClick={onClick}
      className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {getStatusIcon(run.status, 'w-5 h-5')}
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-white truncate">{run.project}</p>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <GitBranch className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{run.feature_branch}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Progress */}
          <div className="hidden sm:flex items-center gap-2 w-32">
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  run.status === 'failed'
                    ? 'bg-red-500'
                    : run.status === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">
              {progress}%
            </span>
          </div>

          <span className="text-xs text-gray-400 dark:text-gray-500 hidden md:block w-16 text-right">
            {formatRelativeTime(run.updated_at)}
          </span>

          <StatusBadge status={run.status} size="sm" />
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    </div>
  );
}
