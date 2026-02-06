import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Target, RefreshCw, ChevronDown, ChevronRight, FolderKanban } from 'lucide-react';
import { useCeceliaPage } from '../../../../dashboard/frontend/src/contexts/CeceliaContext';
import ProgressBar from '../../shared/components/ProgressBar';
import StatusIcon from '../../shared/components/StatusIcon';
import PriorityBadge from '../../shared/components/PriorityBadge';

interface KeyResult {
  id: string;
  title: string;
  progress: number;
  weight: number;
  status: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  goal_id?: string;
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
  linkedProjects?: Project[];
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
          <span>No active objectives</span>
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
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Today's Focus</h2>
            <p className="text-sm text-violet-600 dark:text-violet-400">
              {focus.reason}
              {focus.is_manual && <span className="ml-2 text-xs">(manual)</span>}
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
          {(tree.children.length > 0 || (tree.linkedProjects && tree.linkedProjects.length > 0)) ? (
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
              {tree.linkedProjects && tree.linkedProjects.length > 0 && (
                <span className="flex items-center gap-1">
                  <FolderKanban className="w-3 h-3" />
                  {tree.linkedProjects.length} Projects
                </span>
              )}
              <span>{tree.progress}%</span>
            </div>
          </div>
          <div className="w-32">
            <ProgressBar progress={tree.progress} size="sm" />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
          {/* Key Results */}
          {tree.children.length > 0 && (
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
          )}

          {/* Linked Projects */}
          {tree.linkedProjects && tree.linkedProjects.length > 0 && (
            <div className={tree.children.length > 0 ? "mt-4 pt-4 border-t border-slate-200 dark:border-slate-700" : ""}>
              <div className="flex items-center gap-2 mb-3">
                <FolderKanban className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Linked Projects</span>
              </div>
              <div className="space-y-2">
                {tree.linkedProjects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors group"
                  >
                    <FolderKanban className="w-4 h-4 text-blue-500" />
                    <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {project.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      project.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      project.status === 'completed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      {project.status}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OKRPage() {
  const [trees, setTrees] = useState<OKRTree[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [focus, setFocus] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusLoading, setFocusLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Page actions for Cecelia
  const expandItem = useCallback((id: string) => {
    setExpandedIds(prev => new Set([...prev, id]));
  }, []);

  const collapseItem = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleItem = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(trees.map(t => t.id)));
  }, [trees]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // Ref to hold the actual refresh function (set after fetchData/fetchFocus are defined)
  const refreshRef = useRef<() => void>(() => {});

  // Page actions object for Cecelia
  const pageActions = useMemo(() => ({
    refresh: () => refreshRef.current(),
    expandItem,
    collapseItem,
    toggleItem,
    expandAll,
    collapseAll,
  }), [expandItem, collapseItem, toggleItem, expandAll, collapseAll]);

  // Register with Cecelia
  const { register, unregisterPage } = useCeceliaPage(
    'okr',
    'OKR Dashboard',
    () => trees,
    () => ({ expandedIds: Array.from(expandedIds), loading, focusLoading }),
    pageActions,
    () => {
      const totalOkrs = trees.length;
      const totalKrs = trees.reduce((sum, t) => sum + t.children.length, 0);
      const avgProgress = trees.length > 0
        ? Math.round(trees.reduce((sum, t) => sum + t.progress, 0) / trees.length)
        : 0;
      return `${totalOkrs} OKRs, ${totalKrs} KRs, ${avgProgress}% avg progress`;
    }
  );

  // Update registration when data changes
  useEffect(() => {
    register();
    return () => unregisterPage();
  }, [register, unregisterPage, trees, expandedIds, loading, focusLoading]);

  const fetchData = useCallback(async () => {
    try {
      const [treesRes, projectsRes] = await Promise.all([
        fetch('/api/okr/trees'),
        fetch('/api/tasks/projects')
      ]);

      const [treesData, projectsData] = await Promise.all([
        treesRes.json(),
        projectsRes.json()
      ]);

      setProjects(projectsData);

      // Fetch children for each tree
      const treesWithChildren = await Promise.all(
        treesData.trees.map(async (tree: Objective) => {
          const detailRes = await fetch(`/api/okr/trees/${tree.id}`);
          const treeWithChildren = detailRes.ok
            ? await detailRes.json()
            : { ...tree, children: [] };

          // Link projects to this objective
          const linkedProjects = projectsData.filter((p: Project) => p.goal_id === tree.id);

          return {
            ...treeWithChildren,
            linkedProjects
          };
        })
      );

      setTrees(treesWithChildren);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
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
    fetchData();
    fetchFocus();

    const interval = setInterval(() => {
      fetchData();
      fetchFocus();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchData, fetchFocus]);

  const handleRefresh = () => {
    setLoading(true);
    setFocusLoading(true);
    fetchData();
    fetchFocus();
  };

  // Set the refresh ref so Cecelia can trigger refresh
  refreshRef.current = handleRefresh;

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
            <p className="text-sm text-slate-500 dark:text-slate-400">Objectives & Key Results</p>
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
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">All OKRs</h2>
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
            <p className="text-slate-500 dark:text-slate-400">No OKRs yet</p>
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
