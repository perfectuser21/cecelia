/**
 * LiveSection - Active execution display
 */

import { useEffect, useState } from 'react';
import { Play, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

interface TaskRun {
  id: string;
  prd_id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  current_step: number;
  total_steps: number;
  started_at: string;
  feature_branch?: string;
}

interface Props {
  loading: boolean;
}

export default function LiveSection({ loading: initialLoading }: Props) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRuns() {
      try {
        const response = await fetch('/api/cecelia/overview');
        const data = await response.json();
        if (data.success && data.data) {
          setRuns(data.data.runs || []);
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }

    if (!initialLoading) {
      fetchRuns();
    }
  }, [initialLoading]);

  if (loading || initialLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const runningTasks = runs.filter((r) => r.status === 'running');
  const recentTasks = runs.filter((r) => r.status !== 'running').slice(0, 3);

  if (runningTasks.length === 0 && recentTasks.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 dark:text-slate-400">
        <p className="text-sm">No active executions</p>
        <p className="text-xs mt-1 opacity-75">Cecelia is idle</p>
      </div>
    );
  }

  const getStatusConfig = (status: TaskRun['status']) => {
    switch (status) {
      case 'running':
        return {
          icon: Play,
          color: 'text-blue-500',
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          label: 'Running',
        };
      case 'completed':
        return {
          icon: CheckCircle2,
          color: 'text-emerald-500',
          bg: 'bg-emerald-50 dark:bg-emerald-900/20',
          label: 'Completed',
        };
      case 'failed':
        return {
          icon: AlertTriangle,
          color: 'text-red-500',
          bg: 'bg-red-50 dark:bg-red-900/20',
          label: 'Failed',
        };
      default:
        return {
          icon: Clock,
          color: 'text-slate-500',
          bg: 'bg-slate-50 dark:bg-slate-700/30',
          label: 'Pending',
        };
    }
  };

  return (
    <div className="space-y-4">
      {/* Running tasks */}
      {runningTasks.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
            Active
          </h4>
          {runningTasks.map((task) => {
            const config = getStatusConfig(task.status);
            const progress = task.total_steps > 0
              ? (task.current_step / task.total_steps) * 100
              : 0;

            return (
              <div
                key={task.id}
                className={`p-4 rounded-xl ${config.bg}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <config.icon className={`w-4 h-4 ${config.color} animate-pulse`} />
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {task.prd_id}
                    </span>
                  </div>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Step {task.current_step}/{task.total_steps}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {task.feature_branch && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Branch: {task.feature_branch}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent tasks */}
      {recentTasks.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
            Recent
          </h4>
          {recentTasks.map((task) => {
            const config = getStatusConfig(task.status);

            return (
              <div
                key={task.id}
                className={`flex items-center gap-3 p-3 rounded-xl ${config.bg}`}
              >
                <config.icon className={`w-4 h-4 ${config.color}`} />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  {task.prd_id}
                </span>
                <span className={`text-xs ${config.color}`}>
                  {config.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
