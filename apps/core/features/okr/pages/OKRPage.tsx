import { useState, useEffect, useCallback } from 'react';
import { Target, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface KeyResult {
  id: string;
  title: string;
  progress: number;
  weight: number;
  status: string;
}

interface Objective {
  id: string;
  title: string;
  description?: string;
  priority: string;
  progress: number;
  status: string;
  children_count?: number;
}

interface OKRTree extends Objective {
  children: KeyResult[];
}

interface FocusData {
  focus: {
    objective: {
      id: string;
      title: string;
      description?: string;
      priority: string;
      progress: number;
      status: string;
    };
    key_results: KeyResult[];
    suggested_tasks: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
    }>;
  } | null;
  reason: string;
  is_manual: boolean;
}

function ProgressBar({ progress, size = 'md' }: { progress: number; size?: 'sm' | 'md' }) {
  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2';
  const colorClass = progress >= 80
    ? 'bg-emerald-500'
    : progress >= 50
    ? 'bg-blue-500'
    : progress > 0
    ? 'bg-amber-500'
    : 'bg-slate-300 dark:bg-slate-600';

  return (
    <div className={`w-full ${heightClass} bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden`}>
      <div
        className={`${heightClass} ${colorClass} rounded-full transition-all duration-500`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'in_progress':
      return <Clock className="w-4 h-4 text-blue-500" />;
    case 'cancelled':
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    default:
      return <Clock className="w-4 h-4 text-slate-400" />;
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  const colorClass = priority === 'P0'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    : priority === 'P1'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-400';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {priority}
    </span>
  );
}

function FocusPanel({ focus, loading }: { focus: FocusData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20 rounded-xl p-6 border border-violet-200 dark:border-violet-800">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-violet-200 dark:bg-violet-800 rounded w-1/3" />
          <div className="h-4 bg-violet-200 dark:bg-violet-800 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!focus || !focus.focus) {
    return (
      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 text-slate-500">
          <Target className="w-6 h-6" />
          <span>没有活跃的目标</span>
        </div>
      </div>
    );
  }

  const { objective, key_results } = focus.focus;

  return (
    <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20 rounded-xl p-6 border border-violet-200 dark:border-violet-800">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-500 rounded-lg">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">今日焦点</h2>
            <p className="text-sm text-violet-600 dark:text-violet-400">
              {focus.reason}
              {focus.is_manual && <span className="ml-2 text-xs">(手动设置)</span>}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{objective.progress}%</div>
          <PriorityBadge priority={objective.priority} />
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{objective.title}</h3>
        {objective.description && (
          <p className="text-sm text-slate-600 dark:text-slate-400">{objective.description}</p>
        )}
      </div>

      <ProgressBar progress={objective.progress} />

      {key_results.length > 0 && (
        <div className="mt-4 space-y-2">
          {key_results.map((kr) => (
            <div key={kr.id} className="flex items-center gap-3 text-sm">
              <StatusIcon status={kr.status} />
              <span className="flex-1 text-slate-700 dark:text-slate-300">{kr.title}</span>
              <span className="text-slate-500 dark:text-slate-400 w-12 text-right">{kr.progress}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OKRCard({
  tree,
  expanded,
  onToggle,
}: {
  tree: OKRTree;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {tree.children.length > 0 ? (
            expanded ? (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400" />
            )
          ) : (
            <div className="w-5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-900 dark:text-white truncate">{tree.title}</h3>
              <PriorityBadge priority={tree.priority} />
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
              <span>{tree.children.length} KRs</span>
              <span>{tree.progress}%</span>
            </div>
          </div>
          <div className="w-32">
            <ProgressBar progress={tree.progress} size="sm" />
          </div>
        </div>
      </button>

      {expanded && tree.children.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
          <div className="space-y-3">
            {tree.children.map((kr) => (
              <div key={kr.id} className="flex items-center gap-3">
                <StatusIcon status={kr.status} />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{kr.title}</span>
                <div className="w-20">
                  <ProgressBar progress={kr.progress} size="sm" />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 w-10 text-right">{kr.progress}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OKRPage() {
  const [trees, setTrees] = useState<OKRTree[]>([]);
  const [focus, setFocus] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusLoading, setFocusLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchTrees = useCallback(async () => {
    try {
      const res = await fetch('/api/okr/trees');
      if (!res.ok) throw new Error('Failed to fetch OKR trees');
      const data = await res.json();

      // Fetch children for each tree
      const treesWithChildren = await Promise.all(
        data.trees.map(async (tree: Objective) => {
          const detailRes = await fetch(`/api/okr/trees/${tree.id}`);
          if (detailRes.ok) {
            return detailRes.json();
          }
          return { ...tree, children: [] };
        })
      );

      setTrees(treesWithChildren);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch OKR trees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFocus = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/focus');
      if (!res.ok) throw new Error('Failed to fetch focus');
      const data = await res.json();
      setFocus(data);
    } catch (err) {
      console.error('Failed to fetch focus:', err);
    } finally {
      setFocusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrees();
    fetchFocus();

    const interval = setInterval(() => {
      fetchTrees();
      fetchFocus();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchTrees, fetchFocus]);

  const handleRefresh = () => {
    setLoading(true);
    setFocusLoading(true);
    fetchTrees();
    fetchFocus();
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Target className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">OKR Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">目标与关键成果追踪</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {lastRefresh && (
            <span className="text-xs text-slate-400">
              Last: {lastRefresh.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Focus Panel */}
      <FocusPanel focus={focus} loading={focusLoading} />

      {/* All OKRs */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">所有 OKR</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 animate-pulse">
                <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-2/3 mb-3" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : trees.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700">
            <Target className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 dark:text-slate-400">还没有 OKR</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {trees.map((tree) => (
              <OKRCard
                key={tree.id}
                tree={tree}
                expanded={expandedIds.has(tree.id)}
                onToggle={() => toggleExpanded(tree.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
