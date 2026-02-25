import { Target, TrendingUp } from 'lucide-react';
import { useApiFn } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import { fetchBrainFocus, BrainFocus } from '../api/agents.api';

export default function BrainOKRProgress() {
  const pollOpts = { pollInterval: 5000, staleTime: 5000 };
  const { data: focus, loading } = useApiFn<BrainFocus | null>(
    'brain-focus',
    fetchBrainFocus,
    pollOpts
  );

  if (loading) {
    return <SkeletonCard />;
  }

  const objective = focus?.objective;
  const keyResults = focus?.key_results || [];

  // 获取优先级颜色
  const getPriorityColor = (priority: string) => {
    switch (priority?.toUpperCase()) {
      case 'P0':
        return 'text-red-600 bg-red-100';
      case 'P1':
        return 'text-orange-600 bg-orange-100';
      case 'P2':
        return 'text-blue-600 bg-blue-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600';
      case 'in_progress':
        return 'text-blue-600';
      case 'pending':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'in_progress':
        return '🚧';
      case 'pending':
        return '⏸️';
      default:
        return '⏸️';
    }
  };

  if (!objective) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">OKR 进度</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">暂无聚焦的目标</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">OKR 进度</h2>
      </div>

      {/* Objective */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getPriorityColor(objective.priority)}`}>
            {objective.priority}
          </span>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{objective.title}</h3>
        </div>

        {/* 进度条 */}
        <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300"
            style={{ width: `${objective.progress}%` }}
          ></div>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{objective.progress}% 完成</div>
      </div>

      {/* Key Results */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Key Results ({keyResults.length})
        </h4>

        <div className="space-y-2">
          {keyResults.map((kr) => (
            <div key={kr.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-2 flex-1">
                  <span className="text-sm">{getStatusIcon(kr.status)}</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{kr.title}</span>
                </div>
                <span className={`text-xs font-medium ${getStatusColor(kr.status)}`}>
                  {kr.progress}%
                </span>
              </div>

              {/* KR 进度条 */}
              <div className="relative w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className={`absolute top-0 left-0 h-full transition-all duration-300 ${
                    kr.status === 'completed' ? 'bg-green-500' :
                    kr.status === 'in_progress' ? 'bg-blue-500' :
                    'bg-gray-400'
                  }`}
                  style={{ width: `${kr.progress}%` }}
                ></div>
              </div>

              {/* 任务统计 */}
              {kr.tasks_total > 0 && (
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  任务: {kr.tasks_completed}/{kr.tasks_total} 完成
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
