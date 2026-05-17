import { FolderKanban } from 'lucide-react';
import PRPlanCard from './PRPlanCard';
import type { PRPlan } from '../api/pr-plans.api';
import { isPRPlanBlocked } from '../api/pr-plans.api';

interface PRPlansListProps {
  prPlans: PRPlan[];
  loading?: boolean;
  onPRPlanClick?: (prPlan: PRPlan) => void;
  onStatusUpdate?: (updatedPlan: PRPlan) => void;
}

export default function PRPlansList({ prPlans, loading, onPRPlanClick, onStatusUpdate }: PRPlansListProps) {
  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse">
            <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (!prPlans || prPlans.length === 0) {
    return (
      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-12 border border-slate-200 dark:border-slate-700 text-center">
        <FolderKanban className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          No PR Plans
        </h3>
        <p className="text-slate-500 dark:text-slate-400">
          This initiative doesn't have any PR Plans yet.
        </p>
      </div>
    );
  }

  // Sort by sequence
  const sortedPRPlans = [...prPlans].sort((a, b) => a.sequence - b.sequence);

  // Build dependency lookup
  const prPlanMap = new Map(sortedPRPlans.map(p => [p.id, p]));

  return (
    <div className="space-y-4">
      {sortedPRPlans.map(prPlan => {
        const isBlocked = isPRPlanBlocked(prPlan, sortedPRPlans);

        // Get dependency titles
        const dependencyTitles = prPlan.depends_on
          ?.map(depId => prPlanMap.get(depId)?.title)
          .filter(Boolean) as string[] | undefined;

        return (
          <PRPlanCard
            key={prPlan.id}
            prPlan={prPlan}
            isBlocked={isBlocked}
            dependencyTitles={dependencyTitles}
            allPRPlans={sortedPRPlans}
            onClick={onPRPlanClick ? () => onPRPlanClick(prPlan) : undefined}
            onStatusUpdate={onStatusUpdate}
          />
        );
      })}
    </div>
  );
}
