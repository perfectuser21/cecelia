import { ListTodo, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { useApiFn } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import { fetchTaskQueueStats, fetchBrainTasks, TaskQueueStats, BrainTask } from '../api/agents.api';

export default function BrainTaskQueue() {
  const pollOpts = { pollInterval: 5000, staleTime: 5000 };
  const { data: stats, loading: statsLoading } = useApiFn<TaskQueueStats>(
    'brain-task-stats',
    fetchTaskQueueStats,
    pollOpts
  );
  const { data: inProgressTasks, loading: tasksLoading } = useApiFn<BrainTask[]>(
    'brain-tasks-in-progress',
    () => fetchBrainTasks('in_progress'),
    pollOpts
  );

  if (statsLoading || tasksLoading) {
    return <SkeletonCard />;
  }

  // 计算执行时间
  const getExecutionTime = (task: BrainTask) => {
    if (!task.started_at) return '-';
    const start = new Date(task.started_at);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-4">
        <ListTodo className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">任务队列</h2>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">⏳ Queued</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {stats?.queued || 0}
          </div>
        </div>

        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">🚧 In Progress</div>
          <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
            {stats?.in_progress || 0}
          </div>
        </div>

        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">✅ Completed</div>
          <div className="text-lg font-semibold text-green-600 dark:text-green-400">
            {stats?.completed || 0}
          </div>
        </div>

        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">❌ Failed</div>
          <div className="text-lg font-semibold text-red-600 dark:text-red-400">
            {stats?.failed || 0}
          </div>
        </div>

        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">🔒 Quarantined</div>
          <div className="text-lg font-semibold text-orange-600 dark:text-orange-400">
            {stats?.quarantined || 0}
          </div>
        </div>
      </div>

      {/* 进行中的任务 */}
      {inProgressTasks && inProgressTasks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            进行中 ({inProgressTasks.length})
          </h3>

          <div className="space-y-2">
            {inProgressTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400 px-2 py-0.5 bg-white dark:bg-blue-900/40 rounded">
                      {task.priority}
                    </span>
                    <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                      {task.title}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                  <span>已执行: {getExecutionTime(task)}</span>
                  {task.run_id && <span>Run ID: {task.run_id.slice(0, 12)}</span>}
                </div>
              </div>
            ))}
          </div>

          {inProgressTasks.length > 5 && (
            <p className="text-xs text-gray-600 dark:text-gray-400 text-center">
              还有 {inProgressTasks.length - 5} 个任务...
            </p>
          )}
        </div>
      )}

      {inProgressTasks && inProgressTasks.length === 0 && (
        <div className="text-center py-6">
          <CheckCircle2 className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">暂无进行中的任务</p>
        </div>
      )}
    </div>
  );
}
