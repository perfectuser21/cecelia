/**
 * Dev Tasks - 开发任务追踪页面
 * 实时显示 VPS 上的开发进度
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  Check,
  Circle,
  Clock,
  AlertCircle,
  SkipForward,
  RefreshCw,
  ExternalLink,
  GitPullRequest,
  Loader2,
  FolderGit2,
  ChevronRight,
} from 'lucide-react';
import { getAllTasks, type DevTaskStatus, type StepStatus, type CIStatus } from '../api/dev-tracker.api';

// 步骤状态图标
const StepIcon = ({ status }: { status: StepStatus }) => {
  switch (status) {
    case 'done':
      return <Check className="w-4 h-4 text-slate-500" />;
    case 'in_progress':
      return <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />;
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-slate-600" />;
    case 'skipped':
      return <SkipForward className="w-4 h-4 text-slate-400" />;
    default:
      return <Circle className="w-4 h-4 text-slate-500" />;
  }
};

// CI 状态徽章
const CIBadge = ({ status }: { status: CIStatus }) => {
  const config = {
    passed: { bg: 'bg-slate-500/20', text: 'text-slate-500 dark:text-slate-400', label: '通过' },
    running: { bg: 'bg-slate-400/20', text: 'text-slate-500 dark:text-slate-400', label: '运行中' },
    failed: { bg: 'bg-slate-600/20', text: 'text-slate-600 dark:text-slate-400', label: '失败' },
    pending: { bg: 'bg-slate-400/20', text: 'text-slate-500 dark:text-slate-400', label: '等待中' },
    unknown: { bg: 'bg-slate-500/20', text: 'text-slate-500 dark:text-slate-400', label: '未知' },
  }[status];

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
};

// 分支类型徽章
const BranchTypeBadge = ({ type }: { type: string }) => {
  const config: Record<string, { bg: string; text: string }> = {
    cp: { bg: 'bg-slate-500/20', text: 'text-slate-500 dark:text-slate-400' },
    feature: { bg: 'bg-slate-400/20', text: 'text-slate-500 dark:text-slate-400' },
    develop: { bg: 'bg-slate-500/20', text: 'text-slate-500 dark:text-slate-400' },
    main: { bg: 'bg-slate-600/20', text: 'text-slate-600 dark:text-slate-400' },
    unknown: { bg: 'bg-slate-500/20', text: 'text-slate-500 dark:text-slate-400' },
  };
  const { bg, text } = config[type] || config.unknown;

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {type}
    </span>
  );
};

// 工作流步骤条
const WorkflowSteps = ({ steps }: { steps: DevTaskStatus['steps'] }) => {
  const getStepStyle = (status: StepStatus) => {
    switch (status) {
      case 'done':
        return 'bg-violet-500 border-violet-400 text-white';
      case 'in_progress':
        return 'bg-purple-400 border-purple-300 text-white animate-pulse';
      case 'failed':
        return 'bg-slate-500 border-slate-400 text-white';
      case 'skipped':
        return 'bg-slate-400 border-slate-300 text-white';
      default:
        return 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400';
    }
  };

  const getConnectorStyle = (currentStatus: StepStatus, nextStatus: StepStatus) => {
    if (currentStatus === 'done') {
      return 'bg-violet-400';
    }
    if (currentStatus === 'in_progress') {
      return 'bg-gradient-to-r from-purple-400 to-slate-300 dark:to-slate-600';
    }
    return 'bg-slate-300 dark:bg-slate-600';
  };

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-2">
      {steps.items.map((step, index) => (
        <div key={step.id} className="flex items-center">
          {/* Step Circle */}
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${getStepStyle(step.status)}`}
              title={`${step.name}: ${step.status}`}
            >
              {step.status === 'done' ? (
                <Check className="w-4 h-4" />
              ) : step.status === 'in_progress' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : step.status === 'failed' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                step.id
              )}
            </div>
            <span className={`text-[10px] mt-1 whitespace-nowrap ${
              step.status === 'done' ? 'text-violet-600 dark:text-violet-400' :
              step.status === 'in_progress' ? 'text-purple-500 dark:text-purple-400' :
              step.status === 'failed' ? 'text-slate-500 dark:text-slate-400' :
              'text-slate-400 dark:text-slate-500'
            }`}>
              {step.name}
            </span>
          </div>
          {/* Connector */}
          {index < steps.items.length - 1 && (
            <div
              className={`w-6 h-0.5 -mt-4 ${getConnectorStyle(step.status, steps.items[index + 1].status)}`}
            />
          )}
        </div>
      ))}
    </div>
  );
};

// 任务卡片
const TaskCard = ({ task }: { task: DevTaskStatus }) => {
  const completedSteps = task.steps.items.filter(s => s.status === 'done').length;
  const progressPercent = (completedSteps / task.steps.total) * 100;

  return (
    <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg shadow-slate-200/50 dark:shadow-black/30 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-500/10 flex items-center justify-center">
            <FolderGit2 className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f] dark:text-white">{task.repo.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <GitBranch className="w-3.5 h-3.5 text-[#86868b]" />
              <span className="text-sm text-[#86868b] dark:text-slate-300">{task.branches.current}</span>
              <BranchTypeBadge type={task.branches.type} />
            </div>
          </div>
        </div>
        {task.task.prUrl && (
          <a
            href={task.task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-500/10 text-slate-600 dark:text-slate-400 rounded-lg text-sm hover:bg-slate-500/20 transition-colors"
          >
            <GitPullRequest className="w-4 h-4" />
            #{task.task.prNumber}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-slate-500 dark:text-slate-400">进度</span>
          <span className="text-slate-700 dark:text-slate-300 font-medium">{completedSteps}/{task.steps.total} 步骤</span>
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Workflow Steps */}
      <WorkflowSteps steps={task.steps} />

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-black/5 dark:border-white/10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-[#86868b] dark:text-slate-300">CI:</span>
            <CIBadge status={task.quality.ci} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-slate-300">
          <Clock className="w-3.5 h-3.5" />
          {new Date(task.updatedAt).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
};

// 主页面
export default function DevTasks() {
  const [tasks, setTasks] = useState<DevTaskStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchTasks = useCallback(async () => {
    try {
      const response = await getAllTasks();
      if (response.success && response.data) {
        setTasks(response.data);
        setError(null);
      } else {
        setError(response.error || '获取任务失败');
      }
    } catch (err) {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    // 每 30 秒自动刷新
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleRefresh = () => {
    setLoading(true);
    fetchTasks();
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-white">开发任务</h1>
          <p className="text-[#86868b] dark:text-slate-300 mt-1">实时追踪 VPS 上的开发进度</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[#86868b] dark:text-slate-300">
            最后更新: {lastRefresh.toLocaleTimeString('zh-CN')}
          </span>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-500/10 text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-500/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 text-red-500 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && tasks.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-slate-600 dark:text-slate-400 animate-spin mx-auto mb-4" />
            <p className="text-[#86868b] dark:text-slate-300">加载中...</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && tasks.length === 0 && !error && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FolderGit2 className="w-16 h-16 text-[#86868b] dark:text-slate-300 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-[#1d1d1f] dark:text-white mb-2">暂无活跃任务</h3>
            <p className="text-[#86868b] dark:text-slate-300">所有仓库都在 main 或 develop 分支上</p>
          </div>
        </div>
      )}

      {/* Task Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {tasks.map((task) => (
          <TaskCard key={task.repo.name} task={task} />
        ))}
      </div>

      {/* Legend */}
      {tasks.length > 0 && (
        <div className="mt-8 p-4 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-slate-500 dark:text-slate-400">图例:</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-violet-500" />
              <span className="text-slate-600 dark:text-slate-300">完成</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-slate-600 dark:text-slate-300">进行中</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-500" />
              <span className="text-slate-600 dark:text-slate-300">失败</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-600" />
              <span className="text-slate-600 dark:text-slate-300">待处理</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
