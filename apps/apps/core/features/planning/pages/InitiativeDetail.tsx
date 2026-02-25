import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Target, RefreshCw, AlertCircle, List, Network } from 'lucide-react';
import { useCeceliaPage } from '@/contexts/CeceliaContext';
import PRPlansList from '../components/PRPlansList';
import PRPlanDependencyGraph from '../components/PRPlanDependencyGraph';
import StatusIcon from '../../shared/components/StatusIcon';
import { getInitiative, getPRPlans } from '../api/pr-plans.api';
import type { Initiative, PRPlan } from '../api/pr-plans.api';

export default function InitiativeDetail() {
  const { id } = useParams<{ id: string }>();
  const { setCurrentPage } = useCeceliaPage();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [prPlans, setPRPlans] = useState<PRPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');

  useEffect(() => {
    setCurrentPage('Initiative Detail');
  }, [setCurrentPage]);

  useEffect(() => {
    if (!id) return;

    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      // Load initiative and PR Plans in parallel
      const [initiativeData, prPlansData] = await Promise.all([
        getInitiative(id),
        getPRPlans(id)
      ]);

      setInitiative(initiativeData);
      setPRPlans(prPlansData);
    } catch (err) {
      console.error('Failed to load initiative:', err);
      setError(err instanceof Error ? err.message : 'Failed to load initiative');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    loadData();
  };

  const handleStatusUpdate = (updatedPlan: PRPlan) => {
    // Update local state
    setPRPlans(prev => prev.map(p => p.id === updatedPlan.id ? updatedPlan : p));
  };

  if (loading && !initiative) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
            <div className="h-24 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-6 border border-red-200 dark:border-red-800">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-1">
                  Failed to Load Initiative
                </h3>
                <p className="text-red-700 dark:text-red-300 mb-4">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!initiative) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-12 border border-slate-200 dark:border-slate-700 text-center">
            <Target className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Initiative Not Found
            </h3>
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              The initiative you're looking for doesn't exist.
            </p>
            <Link
              to="/planning/okr"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to OKR
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/planning/okr"
            className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to OKR
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-violet-500 rounded-xl">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  {initiative.title}
                </h1>
                {initiative.description && (
                  <p className="text-slate-600 dark:text-slate-400 mb-3">
                    {initiative.description}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={initiative.status} />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {initiative.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </span>
                  </div>
                  {initiative.goal_id && (
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      • Linked to KR
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* PR Plans Section */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              PR Plans
              <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                ({prPlans.length})
              </span>
            </h2>

            {/* View Toggle */}
            {prPlans.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                <button
                  onClick={() => setViewMode('list')}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded transition-colors text-sm font-medium
                    ${viewMode === 'list'
                      ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }
                  `}
                >
                  <List className="w-4 h-4" />
                  List
                </button>
                <button
                  onClick={() => setViewMode('graph')}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded transition-colors text-sm font-medium
                    ${viewMode === 'graph'
                      ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }
                  `}
                >
                  <Network className="w-4 h-4" />
                  Graph
                </button>
              </div>
            )}
          </div>

          {viewMode === 'list' ? (
            <PRPlansList
              prPlans={prPlans}
              loading={loading}
              onStatusUpdate={handleStatusUpdate}
            />
          ) : (
            <PRPlanDependencyGraph
              prPlans={prPlans}
            />
          )}
        </div>

        {/* Stats */}
        {prPlans.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
              <div className="text-sm text-emerald-600 dark:text-emerald-400 mb-1">Completed</div>
              <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                {prPlans.filter(p => p.status === 'completed').length}
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">In Progress</div>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-200">
                {prPlans.filter(p => p.status === 'in_progress').length}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
              <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Planning</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-200">
                {prPlans.filter(p => p.status === 'planning').length}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
