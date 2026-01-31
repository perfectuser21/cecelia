/**
 * TodaySection - Today's plan display
 */

import { CheckCircle2, Circle } from 'lucide-react';
import type { PlanData } from '../api/panorama.api';

interface Props {
  data: PlanData | null;
  loading: boolean;
}

export default function TodaySection({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-slate-100 dark:bg-slate-700/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 dark:text-slate-400">
        <p className="text-sm">No tasks for today</p>
        <p className="text-xs mt-1 opacity-75">Create a .plan.md file to add tasks</p>
      </div>
    );
  }

  const completedCount = data.items.filter((item) => item.completed).length;
  const totalCount = data.items.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {data.items.map((item) => (
          <div
            key={item.id}
            className={`
              flex items-start gap-3 p-3 rounded-xl transition-colors
              ${item.completed
                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                : 'bg-slate-50 dark:bg-slate-700/30'
              }
            `}
          >
            {item.completed ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-5 h-5 text-slate-400 dark:text-slate-500 flex-shrink-0 mt-0.5" />
            )}
            <span
              className={`
                text-sm
                ${item.completed
                  ? 'text-slate-500 dark:text-slate-400 line-through'
                  : 'text-slate-700 dark:text-slate-300'
                }
              `}
            >
              {item.content}
            </span>
            {item.priority === 'high' && !item.completed && (
              <span className="ml-auto text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                High
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Source indicator */}
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Source: {data.source}
      </p>
    </div>
  );
}
