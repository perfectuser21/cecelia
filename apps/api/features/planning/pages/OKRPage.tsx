import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Target, RefreshCw, ChevronDown, ChevronRight, FolderKanban } from 'lucide-react';
import { useCeceliaPage } from '@/contexts/CeceliaContext';
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
  parent_id?: string | null;
  type?: string;
  kr_id?: string | null;
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

/** 状态颜色映射 */
function statusDot(status: string) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500', in_progress: 'bg-blue-500',
    completed: 'bg-slate-400', planned: 'bg-amber-400', pending: 'bg-slate-400',
  };
  return colors[status] ?? 'bg-slate-400';
}

function statusBadge(status: string) {
  const cls: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completed: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
    planned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    pending: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  };
  return cls[status] ?? 'bg-slate-100 text-slate-500';
}

function OKRCard({
  tree,
  expanded,
  onToggle,
  allProjects,
}: {
  tree: OKRTree;
  expanded: boolean;
  onToggle: () => void;
  allProjects: Project[];
}) {
  const [expandedKrs, setExpandedKrs] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleKr = (id: string) => setExpandedKrs(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleProject = (id: string) => setExpandedProjects(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  // 找顶级 Projects（parent_id 为空，且关联到这个 objective）
  const topProjects = (tree.linkedProjects ?? []).filter(p => !p.parent_id);
  // 找 Initiatives（parent_id 不为空）
  const getInitiatives = (projectId: string) =>
    allProjects.filter(p => p.parent_id === projectId);

  const hasChildren = tree.children.length > 0 || topProjects.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 overflow-hidden">
      {/* Objective 行 */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {hasChildren ? (
            expanded
              ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
              : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          ) : <div className="w-4" />}
          <Target className="w-4 h-4 text-violet-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900 dark:text-white truncate text-sm">{tree.title}</h3>
              <PriorityBadge priority={tree.priority} />
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
              {tree.children.length > 0 && <span>{tree.children.length} KR</span>}
              {topProjects.length > 0 && <span>{topProjects.length} Project</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-24">
              <ProgressBar progress={tree.progress} size="sm" />
            </div>
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300 w-10 text-right">{tree.progress}%</span>
          </div>
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700/50">
          {/* KR 层 */}
          {tree.children.map((kr) => (
            <div key={kr.id} className="border-b border-slate-100 dark:border-slate-700/30 last:border-0">
              {/* KR 行 */}
              <button
                onClick={() => toggleKr(kr.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors text-left"
              >
                <div className="w-4" />
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(kr.status)}`} />
                <StatusIcon status={kr.status} />
                <span className="flex-1 text-sm text-slate-600 dark:text-slate-300 truncate">{kr.title}</span>
                <div className="w-16 flex-shrink-0">
                  <ProgressBar progress={kr.progress} size="sm" />
                </div>
                <span className="text-xs text-slate-400 w-8 text-right flex-shrink-0">{kr.progress}%</span>
                {expandedKrs.has(kr.id)
                  ? <ChevronDown className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                  : <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </button>

              {/* KR 下的 Projects */}
              {expandedKrs.has(kr.id) && (() => {
                const krProjects = allProjects.filter(p =>
                  p.kr_id === kr.id && !p.parent_id
                );
                return krProjects.length > 0 ? (
                  <div className="bg-slate-50/50 dark:bg-slate-900/30">
                    {krProjects.map((proj) => {
                      const initiatives = getInitiatives(proj.id);
                      const projExpanded = expandedProjects.has(proj.id);
                      return (
                        <div key={proj.id}>
                          {/* Project 行 */}
                          <div className="flex items-center gap-3 pl-10 pr-4 py-2 hover:bg-slate-100/60 dark:hover:bg-slate-700/20">
                            {initiatives.length > 0 ? (
                              <button onClick={() => toggleProject(proj.id)} className="flex-shrink-0">
                                {projExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                              </button>
                            ) : <div className="w-3.5" />}
                            <FolderKanban className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <Link
                              to={`/projects/${proj.id}`}
                              className="flex-1 text-sm text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 truncate"
                            >
                              {proj.name}
                            </Link>
                            {initiatives.length > 0 && (
                              <span className="text-xs text-slate-400 flex-shrink-0">{initiatives.length} initiative</span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusBadge(proj.status)}`}>
                              {proj.status}
                            </span>
                          </div>
                          {/* Initiative 层 */}
                          {projExpanded && initiatives.map((ini) => (
                            <div key={ini.id} className="flex items-center gap-3 pl-16 pr-4 py-1.5 bg-slate-50 dark:bg-slate-900/40">
                              <div className="w-3.5" />
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                              <Link
                                to={`/projects/${ini.id}`}
                                className="flex-1 text-xs text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 truncate"
                              >
                                {ini.name}
                              </Link>
                              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusBadge(ini.status)}`}>
                                {ini.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pl-12 py-1.5 text-xs text-slate-400 dark:text-slate-600 italic">暂无关联项目</div>
                );
              })()}
            </div>
          ))}

          {/* 无 KR 但有直连项目时 */}
          {tree.children.length === 0 && topProjects.length > 0 && topProjects.map((proj) => {
            const initiatives = getInitiatives(proj.id);
            const projExpanded = expandedProjects.has(proj.id);
            return (
              <div key={proj.id} className="border-b border-slate-100 dark:border-slate-700/30 last:border-0">
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                  <div className="w-4" />
                  {initiatives.length > 0 ? (
                    <button onClick={() => toggleProject(proj.id)} className="flex-shrink-0">
                      {projExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                  ) : <div className="w-3.5" />}
                  <FolderKanban className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  <Link to={`/projects/${proj.id}`} className="flex-1 text-sm text-slate-600 dark:text-slate-300 hover:text-blue-600 truncate">
                    {proj.name}
                  </Link>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(proj.status)}`}>{proj.status}</span>
                </div>
                {projExpanded && initiatives.map((ini) => (
                  <div key={ini.id} className="flex items-center gap-3 pl-16 pr-4 py-1.5 bg-slate-50 dark:bg-slate-900/40">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    <Link to={`/projects/${ini.id}`} className="flex-1 text-xs text-slate-500 hover:text-amber-600 truncate">{ini.name}</Link>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(ini.status)}`}>{ini.status}</span>
                  </div>
                ))}
              </div>
            );
          })}
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
      const [goalsRes, projectsRes] = await Promise.all([
        fetch('/api/goals?limit=200'),
        fetch('/api/tasks/projects?limit=200')
      ]);

      const [goalsData, projectsData] = await Promise.all([
        goalsRes.json(),
        projectsRes.json()
      ]);

      const allProjects = Array.isArray(projectsData) ? projectsData : [];
      setProjects(allProjects);

      const allGoals = Array.isArray(goalsData) ? goalsData : [];

      // area_okr（无 parent_id）= Objective 层级
      const areaOkrs = allGoals.filter((g: any) => g.type === 'area_okr' && !g.parent_id);

      const treesWithChildren: OKRTree[] = areaOkrs.map((obj: any) => {
        // KR = type='kr'，parent_id 指向该 Objective
        const krs: KeyResult[] = allGoals
          .filter((g: any) => g.parent_id === obj.id && g.type === 'kr')
          .map((kr: any) => ({
            id: kr.id,
            title: kr.title,
            progress: kr.progress ?? 0,
            weight: parseFloat(kr.weight) || 1,
            status: kr.status,
          }));

        // 该 Objective 下所有 KR 关联的 Project
        const krIds = new Set(krs.map(kr => kr.id));
        const linkedProjects = allProjects.filter(
          (p: Project) => p.kr_id && krIds.has(p.kr_id) && !p.parent_id
        );

        return {
          id: obj.id,
          title: obj.title,
          description: obj.description ?? '',
          priority: obj.priority ?? 'P2',
          progress: obj.progress ?? 0,
          status: obj.status ?? 'active',
          children: krs,
          linkedProjects,
        };
      });

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

  // 展开默认：所有 objective 默认展开
  useEffect(() => {
    if (trees.length > 0 && expandedIds.size === 0) {
      setExpandedIds(new Set(trees.map(t => t.id)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">OKR 全景</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Objective → KR → Project → Initiative</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-400">{lastRefresh.toLocaleTimeString('zh-CN')}</span>
          )}
          <button
            onClick={() => { setExpandedIds(new Set(trees.map(t => t.id))); }}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >全展开</button>
          <button
            onClick={() => setExpandedIds(new Set())}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >全折叠</button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* OKR 层级树 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-2" />
              <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : trees.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-10 text-center border border-slate-200 dark:border-slate-700">
          <Target className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">暂无 OKR 数据</p>
          <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">通过秋米 (/okr) 创建第一个目标</p>
        </div>
      ) : (
        <div className="space-y-2">
          {trees.map((tree) => (
            <OKRCard
              key={tree.id}
              tree={tree}
              expanded={expandedIds.has(tree.id)}
              onToggle={() => toggleExpanded(tree.id)}
              allProjects={projects}
            />
          ))}
        </div>
      )}
    </div>
  );
}
