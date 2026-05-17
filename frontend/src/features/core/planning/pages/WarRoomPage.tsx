import { useState, useEffect, useCallback } from 'react';
import { Swords, Target, Clock, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';

interface Objective {
  id: string;
  title: string;
  status: string;
  progress_pct: number;
}

interface KeyResult {
  id: string;
  title: string;
  status: string;
  progress_pct: string;
}

interface OKRData {
  success: boolean;
  objectives: Array<Objective & { key_results: KeyResult[] }>;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  domain?: string;
  task_type?: string;
}

interface TasksData {
  tasks: Task[];
  total: number;
}

function StatusDot({ status }: { status: string }) {
  const cls = status === 'in_progress' ? 'bg-blue-400 animate-pulse'
    : status === 'active' ? 'bg-emerald-400'
    : status === 'completed' ? 'bg-slate-300'
    : 'bg-amber-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600';
  return (
    <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function WarRoomPage() {
  const [okr, setOkr] = useState<OKRData | null>(null);
  const [tasks, setTasks] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [okrRes, tasksRes] = await Promise.all([
        fetch('/api/brain/okr/current'),
        fetch('/api/brain/tasks?status=in_progress&limit=20'),
      ]);
      const [okrData, tasksData] = await Promise.all([okrRes.json(), tasksRes.json()]);
      setOkr(okrData);
      setTasks(tasksData);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('WarRoom fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeObjectives = okr?.objectives?.filter(o => o.status === 'active') ?? [];
  const focusObjective = activeObjectives[0] ?? null;
  const inProgressTasks = tasks?.tasks ?? [];
  const totalTasks = tasks?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-red-500 to-orange-600 rounded-xl">
            <Swords className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">作战室</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">实时状态 · 自动刷新 30s</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-400">
              {lastRefresh.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            disabled={loading}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3">
          <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
            <Target className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{activeObjectives.length}</div>
            <div className="text-xs text-slate-500">活跃 OKR</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{totalTasks}</div>
            <div className="text-xs text-slate-500">进行中任务</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {focusObjective ? `${Math.round(Number(focusObjective.progress_pct))}%` : '-'}
            </div>
            <div className="text-xs text-slate-500">聚焦 OKR 进度</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Focus */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            当前聚焦方向
          </h2>
          {loading && !focusObjective ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 animate-pulse space-y-3">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
            </div>
          ) : focusObjective ? (
            <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20 rounded-xl border border-violet-200 dark:border-violet-800 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                <p className="font-semibold text-slate-900 dark:text-white leading-snug">{focusObjective.title}</p>
              </div>
              <ProgressBar pct={focusObjective.progress_pct} />
              <div className="text-sm text-violet-600 dark:text-violet-400 font-medium">
                进度 {Math.round(focusObjective.progress_pct)}%
              </div>
              {focusObjective.key_results?.length > 0 && (
                <div className="space-y-2 pt-1">
                  {focusObjective.key_results.slice(0, 4).map(kr => (
                    <div key={kr.id} className="flex items-center gap-2 text-sm">
                      <StatusDot status={kr.status} />
                      <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{kr.title}</span>
                      <span className="text-xs text-slate-500 w-8 text-right">{Math.round(Number(kr.progress_pct))}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-center">
              <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">暂无活跃 OKR</p>
            </div>
          )}

          {/* Other active OKRs */}
          {activeObjectives.length > 1 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-400 uppercase tracking-wide">其他活跃 OKR</p>
              {activeObjectives.slice(1, 4).map(obj => (
                <div key={obj.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center gap-2">
                  <StatusDot status={obj.status} />
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{obj.title}</span>
                  <span className="text-xs text-slate-400">{Math.round(obj.progress_pct)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* In-Progress Tasks */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            进行中任务（{totalTasks}）
          </h2>
          {loading && inProgressTasks.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : inProgressTasks.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-300 dark:text-emerald-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">暂无进行中任务</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {inProgressTasks.map(task => (
                <div key={task.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <Clock className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                    <span className="flex-1 text-sm text-slate-800 dark:text-slate-200 leading-snug">{task.title}</span>
                    {task.priority && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                        task.priority === 'P0' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : task.priority === 'P1' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}>
                        {task.priority}
                      </span>
                    )}
                  </div>
                  {(task.domain || task.task_type) && (
                    <div className="ml-5 mt-1 text-xs text-slate-400">
                      {task.domain}{task.domain && task.task_type ? ' · ' : ''}{task.task_type}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
