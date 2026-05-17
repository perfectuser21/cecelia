import { useMemo } from 'react';
import { PRPlan } from '../api/pr-plans.api.ts';
import { isPRPlanBlocked } from '../api/pr-plans.api.ts';

interface Props {
  prPlans: PRPlan[];
  onNodeClick?: (prPlanId: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#6e7681',
  in_progress: '#3b82f6',
  completed: '#10b981',
  blocked: '#ef4444',
};

export default function PRPlanDependencyGraph({ prPlans, onNodeClick }: Props) {
  const sorted = useMemo(() => {
    if (!prPlans || prPlans.length === 0) return [];
    return [...prPlans].sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
  }, [prPlans]);

  if (sorted.length === 0) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">暂无 PR 计划</div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {sorted.map((plan, idx) => {
        const blocked = isPRPlanBlocked(plan, prPlans);
        const color = blocked ? STATUS_COLOR.blocked : (STATUS_COLOR[plan.status] ?? STATUS_COLOR.pending);
        return (
          <div
            key={plan.id}
            onClick={() => onNodeClick?.(plan.id)}
            className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
          >
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
              style={{ background: color }}
            >
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-slate-900 dark:text-white truncate">{plan.title}</div>
              {plan.description && (
                <div className="text-xs text-slate-400 truncate mt-0.5">{plan.description}</div>
              )}
              {plan.depends_on && plan.depends_on.length > 0 && (
                <div className="text-xs text-slate-400 mt-1">依赖 {plan.depends_on.length} 个前置 PR</div>
              )}
            </div>
            <span
              className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: color + '1a', color }}
            >
              {blocked ? '阻塞' : plan.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
