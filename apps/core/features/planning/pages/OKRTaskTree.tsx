import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target,
  RefreshCw,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  ListTodo,
  AlertTriangle,
  Unlock,
  Filter,
  Crosshair,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────

interface Goal {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: string;
  progress: number;
  type: string; // 'objective' | 'key_result'
  description: string | null;
}

interface Task {
  id: string;
  goal_id: string | null;
  title: string;
  status: string;
  priority: string;
  task_type: string;
  created_at: string;
  completed_at: string | null;
}

interface QuarantineTask {
  id: string;
  title: string;
  reason: string;
  quarantined_at: string;
  priority: string;
}

interface FocusData {
  focus: {
    objective: {
      id: string;
      title: string;
      priority: string;
      progress: number;
      status: string;
    };
    key_results: Array<{
      id: string;
      title: string;
      progress: number;
      status: string;
    }>;
  };
}

// ── Helpers ────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

type PriorityFilter = 'all' | 'P0' | 'P1' | 'P2';
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'queued';

// ── Component ──────────────────────────────────────────

export default function OKRTaskTree() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineTask[]>([]);
  const [focus, setFocus] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const [expandedObjectives, setExpandedObjectives] = useState<Set<string>>(new Set());
  const [expandedKRs, setExpandedKRs] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showQuarantine, setShowQuarantine] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [g, t, q, f] = await Promise.all([
        fetchJson<Goal[]>('/api/tasks/goals'),
        fetchJson<Task[]>('/api/tasks/tasks'),
        fetchJson<{ success: boolean; tasks: QuarantineTask[] }>('/api/brain/quarantine'),
        fetchJson<FocusData>('/api/brain/focus'),
      ]);
      setGoals(g);
      setTasks(t);
      setQuarantine(q.tasks || []);
      setFocus(f);
      setError(null);
      setLastUpdate(new Date());

      // Auto-expand focus objective on first load
      if (f?.focus?.objective?.id && expandedObjectives.size === 0) {
        setExpandedObjectives(new Set([f.focus.objective.id]));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Data processing ──────────────────────────────────

  const objectives = useMemo(() =>
    goals.filter(g => g.type === 'objective' || !g.parent_id),
    [goals]
  );

  const keyResultsByObj = useMemo(() => {
    const map = new Map<string, Goal[]>();
    goals
      .filter(g => g.parent_id)
      .forEach(kr => {
        const list = map.get(kr.parent_id!) || [];
        list.push(kr);
        map.set(kr.parent_id!, list);
      });
    return map;
  }, [goals]);

  const tasksByGoal = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach(t => {
      if (t.goal_id) {
        const list = map.get(t.goal_id) || [];
        list.push(t);
        map.set(t.goal_id, list);
      }
    });
    return map;
  }, [tasks]);

  // Stats
  const stats = useMemo(() => {
    const s = { queued: 0, in_progress: 0, completed: 0, total: tasks.length };
    tasks.forEach(t => {
      if (t.status === 'queued') s.queued++;
      else if (t.status === 'in_progress') s.in_progress++;
      else if (t.status === 'completed') s.completed++;
    });
    return s;
  }, [tasks]);

  // Filter
  const passesFilter = useCallback((priority: string, status: string) => {
    if (priorityFilter !== 'all' && priority !== priorityFilter) return false;
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    return true;
  }, [priorityFilter, statusFilter]);

  // ── Toggle helpers ────────────────────────────────────

  const toggleObjective = (id: string) => {
    setExpandedObjectives(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleKR = (id: string) => {
    setExpandedKRs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const releaseFromQuarantine = async (taskId: string) => {
    try {
      await fetch(`/api/brain/quarantine/${taskId}/release`, { method: 'POST' });
      fetchAll();
    } catch {
      // silent
    }
  };

  // ── Loading / Error ────────────────────────────────────

  if (loading && goals.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && goals.length === 0) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">Failed to load: {error}</p>
        <button onClick={fetchAll} className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Target className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Task Management</h1>
            <p className="text-gray-400">OKR → Task hierarchy</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {focus?.focus?.objective && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <Crosshair className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-blue-400 truncate max-w-[200px]">
                {focus.focus.objective.title}
              </span>
            </div>
          )}
          {lastUpdate && (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button onClick={fetchAll} className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <StatBadge label="Queued" count={stats.queued} color="text-gray-400" bg="bg-slate-700" />
          <StatBadge label="In Progress" count={stats.in_progress} color="text-blue-400" bg="bg-blue-500/20" />
          <StatBadge label="Done" count={stats.completed} color="text-emerald-400" bg="bg-emerald-500/20" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value as PriorityFilter)}
            className="bg-slate-700 text-sm text-gray-300 rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Priority</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-slate-700 text-sm text-gray-300 rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="queued">Queued</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Objective Tree */}
      <div className="space-y-3">
        {objectives.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center text-gray-500">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No objectives found</p>
          </div>
        ) : (
          objectives
            .filter(obj => passesFilter(obj.priority, obj.status))
            .map(obj => (
              <ObjectiveNode
                key={obj.id}
                objective={obj}
                keyResults={keyResultsByObj.get(obj.id) || []}
                tasksByGoal={tasksByGoal}
                expanded={expandedObjectives.has(obj.id)}
                expandedKRs={expandedKRs}
                onToggle={() => toggleObjective(obj.id)}
                onToggleKR={toggleKR}
                passesFilter={passesFilter}
                isFocused={focus?.focus?.objective?.id === obj.id}
              />
            ))
        )}
      </div>

      {/* Quarantine Section */}
      {quarantine.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-amber-500/30">
          <button
            onClick={() => setShowQuarantine(!showQuarantine)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span className="font-medium text-white">Quarantine</span>
              <span className="text-sm text-amber-400">{quarantine.length} tasks</span>
            </div>
            {showQuarantine ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
          </button>
          {showQuarantine && (
            <div className="border-t border-slate-700 divide-y divide-slate-700/50">
              {quarantine.map(qt => (
                <div key={qt.id} className="flex items-center justify-between p-3 px-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{qt.title}</div>
                    <div className="text-xs text-amber-400">{qt.reason}</div>
                  </div>
                  <button
                    onClick={() => releaseFromQuarantine(qt.id)}
                    className="flex items-center gap-1 px-3 py-1 text-xs bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors ml-3"
                  >
                    <Unlock className="w-3 h-3" />
                    Release
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function StatBadge({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${bg}`}>
      <span className={`text-lg font-bold ${color}`}>{count}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

function ObjectiveNode({ objective, keyResults, tasksByGoal, expanded, expandedKRs, onToggle, onToggleKR, passesFilter, isFocused }: {
  objective: Goal;
  keyResults: Goal[];
  tasksByGoal: Map<string, Task[]>;
  expanded: boolean;
  expandedKRs: Set<string>;
  onToggle: () => void;
  onToggleKR: (id: string) => void;
  passesFilter: (priority: string, status: string) => boolean;
  isFocused: boolean;
}) {
  // Count tasks under this objective (including KR tasks)
  const allKrIds = keyResults.map(kr => kr.id);
  const allTaskIds = [objective.id, ...allKrIds];
  const totalTasks = allTaskIds.reduce((sum, id) => sum + (tasksByGoal.get(id)?.length || 0), 0);

  return (
    <div className={`bg-slate-800 rounded-xl border ${isFocused ? 'border-blue-500/40' : 'border-slate-700'}`}>
      {/* Objective Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-700/30 transition-colors rounded-t-xl"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
        )}
        <Target className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <span className="font-medium text-white flex-1 truncate">{objective.title}</span>
        {isFocused && (
          <Crosshair className="w-4 h-4 text-blue-400 flex-shrink-0" />
        )}
        <PriorityBadge priority={objective.priority} />
        <ProgressBar progress={objective.progress} />
        <span className="text-xs text-gray-500 flex-shrink-0">{totalTasks} tasks</span>
      </button>

      {/* Expanded: KRs */}
      {expanded && (
        <div className="border-t border-slate-700/50">
          {keyResults.length === 0 ? (
            <div className="p-4 pl-12 text-sm text-gray-500">No key results</div>
          ) : (
            keyResults
              .filter(kr => passesFilter(kr.priority, kr.status))
              .map(kr => {
                const krTasks = tasksByGoal.get(kr.id) || [];
                const krExpanded = expandedKRs.has(kr.id);
                return (
                  <div key={kr.id} className="border-t border-slate-700/30">
                    {/* KR Header */}
                    <button
                      onClick={() => onToggleKR(kr.id)}
                      className="w-full flex items-center gap-3 p-3 pl-10 text-left hover:bg-slate-700/20 transition-colors"
                    >
                      {krExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      )}
                      <span className="text-sm text-gray-300 flex-1 truncate">{kr.title}</span>
                      <PriorityBadge priority={kr.priority} small />
                      <ProgressBar progress={kr.progress} small />
                      <span className="text-xs text-gray-500 flex-shrink-0">{krTasks.length}</span>
                    </button>

                    {/* KR Tasks */}
                    {krExpanded && krTasks.length > 0 && (
                      <div className="bg-slate-900/30">
                        {krTasks
                          .filter(t => passesFilter(t.priority, t.status))
                          .map(task => (
                            <TaskRow key={task.id} task={task} />
                          ))}
                      </div>
                    )}
                    {krExpanded && krTasks.length === 0 && (
                      <div className="p-3 pl-20 text-xs text-gray-600">No tasks</div>
                    )}
                  </div>
                );
              })
          )}

          {/* Direct tasks under objective (no KR) */}
          {(tasksByGoal.get(objective.id) || [])
            .filter(t => passesFilter(t.priority, t.status))
            .map(task => (
              <div key={task.id} className="border-t border-slate-700/30 bg-slate-900/20">
                <TaskRow task={task} indent />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, indent }: { task: Task; indent?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3 ${indent ? 'pl-12' : 'pl-20'} hover:bg-slate-700/10 transition-colors`}>
      <ListTodo className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
      <span className="text-sm text-gray-300 flex-1 truncate">{task.title}</span>
      {task.task_type && (
        <span className="px-1.5 py-0.5 text-xs rounded bg-slate-700 text-gray-400">{task.task_type}</span>
      )}
      <PriorityBadge priority={task.priority} small />
      <StatusBadge status={task.status} />
    </div>
  );
}

function PriorityBadge({ priority, small }: { priority: string; small?: boolean }) {
  const cls = priority === 'P0'
    ? 'bg-red-500/20 text-red-400'
    : priority === 'P1'
    ? 'bg-amber-500/20 text-amber-400'
    : 'bg-slate-700 text-gray-400';

  return (
    <span className={`${small ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'} rounded ${cls} flex-shrink-0`}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'completed'
    ? 'bg-emerald-500/20 text-emerald-400'
    : status === 'in_progress'
    ? 'bg-blue-500/20 text-blue-400'
    : status === 'queued'
    ? 'bg-cyan-500/20 text-cyan-400'
    : 'bg-slate-700 text-gray-400';

  return (
    <span className={`px-2 py-0.5 text-xs rounded flex-shrink-0 ${cls}`}>
      {status}
    </span>
  );
}

function ProgressBar({ progress, small }: { progress: number; small?: boolean }) {
  const color = progress >= 80 ? 'bg-emerald-500' : progress >= 40 ? 'bg-blue-500' : 'bg-slate-600';
  return (
    <div className={`flex items-center gap-2 flex-shrink-0 ${small ? 'w-20' : 'w-28'}`}>
      <div className={`flex-1 ${small ? 'h-1' : 'h-1.5'} bg-slate-700 rounded-full overflow-hidden`}>
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} />
      </div>
      <span className={`${small ? 'text-xs' : 'text-xs'} text-gray-500 w-8 text-right`}>{progress}%</span>
    </div>
  );
}
