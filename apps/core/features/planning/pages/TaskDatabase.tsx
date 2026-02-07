import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  GripVertical,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  LayoutList,
  Columns,
} from 'lucide-react';
import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { formatRelativeTime } from '../../shared/utils/formatters';

// ── Types ──────────────────────────────────────────────

interface Goal {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: string;
  progress: number;
  type: string;
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
  project_id?: string | null;
}

interface Project {
  id: string;
  name: string;
  repo_path?: string;
  parent_id?: string | null;
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

// ── Constants ──────────────────────────────────────────

type ViewMode = 'table' | 'board';
type GroupBy = 'none' | 'status' | 'priority' | 'project' | 'month';
type SortField = 'title' | 'status' | 'priority' | 'project' | 'task_type' | 'created_at';
type SortDir = 'asc' | 'desc';

const PRIORITIES = ['P0', 'P1', 'P2'] as const;
const TASK_STATUSES = ['queued', 'in_progress', 'completed', 'cancelled'] as const;
const BOARD_COLUMNS: { key: string; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
];

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
const STATUS_ORDER: Record<string, number> = { queued: 0, in_progress: 1, completed: 2, cancelled: 3 };

// ── Helpers ────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function patchEntity(type: 'tasks' | 'goals', id: string, data: Record<string, string>): Promise<void> {
  const r = await fetch(`/api/tasks/${type}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || err.details || 'Failed to update');
  }
}

function priorityColor(p: string) {
  return p === 'P0' ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : p === 'P1' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-slate-700 text-gray-400 border-slate-600';
}

function statusColor(s: string) {
  return s === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : s === 'in_progress' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    : s === 'queued' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
    : s === 'cancelled' ? 'bg-red-500/10 text-red-300 border-red-500/20'
    : 'bg-slate-700 text-gray-400 border-slate-600';
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Main Component ─────────────────────────────────────

export default function TaskDatabase() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineTask[]>([]);
  const [focus, setFocus] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showQuarantine, setShowQuarantine] = useState(true);

  // Row order (localStorage)
  const [rowOrder, setRowOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('taskdb_row_order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
  const showToast = useCallback((msg: string, type: 'error' | 'success' = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Data fetching ───────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [t, g, p, q, f] = await Promise.all([
        fetchJson<Task[]>('/api/tasks/tasks'),
        fetchJson<Goal[]>('/api/tasks/goals'),
        fetchJson<Project[]>('/api/tasks/projects'),
        fetchJson<{ success: boolean; tasks: QuarantineTask[] }>('/api/brain/quarantine'),
        fetchJson<FocusData>('/api/brain/focus'),
      ]);
      setTasks(t);
      setGoals(g);
      setProjects(p);
      setQuarantine(q.tasks || []);
      setFocus(f);
      setError(null);
      setLastUpdate(new Date());
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

  // Persist row order
  useEffect(() => {
    if (rowOrder.length > 0) {
      localStorage.setItem('taskdb_row_order', JSON.stringify(rowOrder));
    }
  }, [rowOrder]);

  // ── Lookup maps ─────────────────────────────────────

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  const goalMap = useMemo(() => {
    const m = new Map<string, Goal>();
    goals.forEach(g => m.set(g.id, g));
    return m;
  }, [goals]);

  // ── Stats ───────────────────────────────────────────

  const stats = useMemo(() => {
    const s = { queued: 0, in_progress: 0, completed: 0, total: tasks.length };
    tasks.forEach(t => {
      if (t.status === 'queued') s.queued++;
      else if (t.status === 'in_progress') s.in_progress++;
      else if (t.status === 'completed') s.completed++;
    });
    return s;
  }, [tasks]);

  // ── Sorting ─────────────────────────────────────────

  const getProjectName = useCallback((t: Task): string => {
    if (t.project_id) return projectMap.get(t.project_id)?.name || '';
    if (t.goal_id) {
      const goal = goalMap.get(t.goal_id);
      if (goal?.parent_id) {
        const parent = goalMap.get(goal.parent_id);
        return parent?.title || '';
      }
      return goal?.title || '';
    }
    return '';
  }, [projectMap, goalMap]);

  const sortedTasks = useMemo(() => {
    const list = [...tasks];

    // If custom row order and no active sort/group, use stored order
    if (groupBy === 'none' && rowOrder.length > 0 && sortField === 'created_at' && sortDir === 'desc') {
      const orderMap = new Map(rowOrder.map((id, i) => [id, i]));
      list.sort((a, b) => {
        const ai = orderMap.get(a.id);
        const bi = orderMap.get(b.id);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return 0;
      });
      return list;
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case 'priority':
          cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
          break;
        case 'project':
          cmp = getProjectName(a).localeCompare(getProjectName(b));
          break;
        case 'task_type':
          cmp = (a.task_type || '').localeCompare(b.task_type || '');
          break;
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [tasks, sortField, sortDir, groupBy, rowOrder, getProjectName]);

  // ── Grouping ────────────────────────────────────────

  const groupedTasks = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: 'All Tasks', tasks: sortedTasks }];

    const groups = new Map<string, Task[]>();
    sortedTasks.forEach(t => {
      let key: string;
      switch (groupBy) {
        case 'status': key = t.status; break;
        case 'priority': key = t.priority; break;
        case 'project': key = getProjectName(t) || 'No Project'; break;
        case 'month': key = getMonthKey(t.created_at); break;
        default: key = 'all';
      }
      const list = groups.get(key) || [];
      list.push(t);
      groups.set(key, list);
    });

    return Array.from(groups.entries()).map(([key, tasks]) => ({
      key,
      label: key,
      tasks,
    }));
  }, [sortedTasks, groupBy, getProjectName]);

  // ── Inline edit ─────────────────────────────────────

  const updateTaskField = useCallback(async (id: string, field: 'priority' | 'status', value: string) => {
    const prev = tasks.find(t => t.id === id);
    if (!prev) return;
    setTasks(ts => ts.map(t => t.id === id ? { ...t, [field]: value } : t));
    try {
      await patchEntity('tasks', id, { [field]: value });
      showToast(`Updated ${field}`, 'success');
    } catch (e: any) {
      setTasks(ts => ts.map(t => t.id === id ? { ...t, [field]: prev[field] } : t));
      showToast(e.message);
    }
  }, [tasks, showToast]);

  // ── Drag & drop ─────────────────────────────────────

  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    if (viewMode === 'board') {
      // Board: cross-column = change status
      const newStatus = destination.droppableId;
      if (newStatus !== source.droppableId) {
        updateTaskField(draggableId, 'status', newStatus);
      }
    } else {
      // Table: reorder rows
      if (source.droppableId === destination.droppableId && source.index !== destination.index) {
        const currentIds = sortedTasks.map(t => t.id);
        const [removed] = currentIds.splice(source.index, 1);
        currentIds.splice(destination.index, 0, removed);
        setRowOrder(currentIds);
        // Reset sort to default so custom order takes effect
        setSortField('created_at');
        setSortDir('desc');
      }
    }
  }, [viewMode, sortedTasks, updateTaskField]);

  // ── Sort toggle ─────────────────────────────────────

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    // Clear custom row order when sorting explicitly
    setRowOrder([]);
  }, [sortField]);

  // ── Group collapse ──────────────────────────────────

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── Quarantine ──────────────────────────────────────

  const releaseFromQuarantine = async (taskId: string) => {
    try {
      await fetch(`/api/brain/quarantine/${taskId}/release`, { method: 'POST' });
      fetchAll();
    } catch { /* silent */ }
  };

  // ── Render ──────────────────────────────────────────

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && tasks.length === 0) {
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
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Target className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Task Database</h1>
            <p className="text-gray-400">{stats.total} tasks</p>
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

      {/* Toolbar: Stats + View + Group */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Stats */}
        <div className="flex items-center gap-3">
          <StatBadge label="Queued" count={stats.queued} color="text-gray-400" bg="bg-slate-700" />
          <StatBadge label="In Progress" count={stats.in_progress} color="text-blue-400" bg="bg-blue-500/20" />
          <StatBadge label="Done" count={stats.completed} color="text-emerald-400" bg="bg-emerald-500/20" />
        </div>
        <div className="flex-1" />

        {/* Group By */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value as GroupBy)}
            disabled={viewMode === 'board'}
            className="bg-slate-700 text-sm text-gray-300 rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="none">No Grouping</option>
            <option value="status">By Status</option>
            <option value="priority">By Priority</option>
            <option value="project">By Project</option>
            <option value="month">By Month</option>
          </select>
        </div>

        {/* View Toggle */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5 border border-slate-700">
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'table' ? 'bg-slate-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" /> Table
          </button>
          <button
            onClick={() => setViewMode('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'board' ? 'bg-slate-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" /> Board
          </button>
        </div>
      </div>

      {/* Content */}
      <DragDropContext onDragEnd={handleDragEnd}>
        {viewMode === 'table' ? (
          <TaskTableView
            groupedTasks={groupedTasks}
            groupBy={groupBy}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            getProjectName={getProjectName}
            onTaskUpdate={updateTaskField}
          />
        ) : (
          <TaskBoardView
            tasks={sortedTasks}
            getProjectName={getProjectName}
            onTaskUpdate={updateTaskField}
          />
        )}
      </DragDropContext>

      {/* Quarantine */}
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
            {showQuarantine ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
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
                    <Unlock className="w-3 h-3" /> Release
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all ${
          toast.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-emerald-500/90 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Table View ─────────────────────────────────────────

function TaskTableView({
  groupedTasks,
  groupBy,
  sortField,
  sortDir,
  onSort,
  collapsedGroups,
  onToggleGroup,
  getProjectName,
  onTaskUpdate,
}: {
  groupedTasks: { key: string; label: string; tasks: Task[] }[];
  groupBy: GroupBy;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  getProjectName: (t: Task) => string;
  onTaskUpdate: (id: string, field: 'priority' | 'status', value: string) => void;
}) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center border-b border-slate-700 bg-slate-800/80 text-xs font-medium text-gray-400 uppercase tracking-wider">
        <div className="w-8 flex-shrink-0" />
        <SortableHeader field="title" label="Title" flex="flex-1" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortableHeader field="status" label="Status" width="w-[120px]" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortableHeader field="priority" label="Priority" width="w-[80px]" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortableHeader field="project" label="Project" width="w-[150px]" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortableHeader field="task_type" label="Type" width="w-[100px]" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortableHeader field="created_at" label="Created" width="w-[120px]" sortField={sortField} sortDir={sortDir} onSort={onSort} />
      </div>

      {/* Body */}
      {groupedTasks.map(group => (
        <div key={group.key}>
          {/* Group header */}
          {groupBy !== 'none' && (
            <button
              onClick={() => onToggleGroup(group.key)}
              className="w-full flex items-center gap-2 px-4 py-2 bg-slate-750 border-b border-slate-700/50 hover:bg-slate-700/50 transition-colors text-left"
            >
              {collapsedGroups.has(group.key) ? (
                <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
              )}
              <span className="text-sm font-medium text-gray-300">{group.label}</span>
              <span className="text-xs text-gray-500">{group.tasks.length}</span>
            </button>
          )}

          {/* Task rows */}
          {!collapsedGroups.has(group.key) && (
            <Droppable droppableId={`table-${group.key}`}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {group.tasks.map((task, index) => (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`group flex items-center border-b border-slate-700/30 hover:bg-slate-700/20 transition-all duration-200 ${
                            snapshot.isDragging ? 'bg-slate-700/40 shadow-xl scale-[1.02] rounded-lg' : ''
                          }`}
                        >
                          {/* Drag handle */}
                          <div {...provided.dragHandleProps} className="w-8 flex items-center justify-center flex-shrink-0 cursor-grab active:cursor-grabbing">
                            <GripVertical className="w-3.5 h-3.5 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                          </div>
                          {/* Title */}
                          <div className="flex-1 min-w-0 px-3 py-3">
                            <span className="text-sm text-gray-200 truncate block">{task.title}</span>
                          </div>
                          {/* Status */}
                          <div className="w-[120px] flex-shrink-0 px-2">
                            <EditableStatus status={task.status} options={TASK_STATUSES} onChange={v => onTaskUpdate(task.id, 'status', v)} />
                          </div>
                          {/* Priority */}
                          <div className="w-[80px] flex-shrink-0 px-2">
                            <EditablePriority priority={task.priority} onChange={v => onTaskUpdate(task.id, 'priority', v)} />
                          </div>
                          {/* Project */}
                          <div className="w-[150px] flex-shrink-0 px-2">
                            <span className="text-xs text-gray-500 truncate block">{getProjectName(task)}</span>
                          </div>
                          {/* Type */}
                          <div className="w-[100px] flex-shrink-0 px-2">
                            {task.task_type && (
                              <span className="px-1.5 py-0.5 text-xs rounded bg-slate-700 text-gray-400">{task.task_type}</span>
                            )}
                          </div>
                          {/* Created */}
                          <div className="w-[120px] flex-shrink-0 px-2">
                            <span className="text-xs text-gray-500">{formatRelativeTime(task.created_at)}</span>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      ))}

      {/* Empty */}
      {groupedTasks.every(g => g.tasks.length === 0) && (
        <div className="p-8 text-center text-gray-500">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No tasks found</p>
        </div>
      )}
    </div>
  );
}

// ── Board View ─────────────────────────────────────────

function TaskBoardView({
  tasks,
  getProjectName,
  onTaskUpdate,
}: {
  tasks: Task[];
  getProjectName: (t: Task) => string;
  onTaskUpdate: (id: string, field: 'priority' | 'status', value: string) => void;
}) {
  const columnTasks = useMemo(() => {
    const m = new Map<string, Task[]>();
    BOARD_COLUMNS.forEach(c => m.set(c.key, []));
    tasks.forEach(t => {
      const list = m.get(t.status);
      if (list) list.push(t);
    });
    return m;
  }, [tasks]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map(col => {
        const colTasks = columnTasks.get(col.key) || [];
        return (
          <div key={col.key} className="flex-1 min-w-[280px]">
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${
                col.key === 'queued' ? 'bg-cyan-400' : col.key === 'in_progress' ? 'bg-blue-400' : 'bg-emerald-400'
              }`} />
              <span className="text-sm font-medium text-gray-300">{col.label}</span>
              <span className="text-xs text-gray-500">{colTasks.length}</span>
            </div>

            {/* Droppable column */}
            <Droppable droppableId={col.key}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`space-y-2 min-h-[200px] p-2 rounded-xl border transition-colors ${
                    snapshot.isDraggingOver
                      ? 'bg-slate-700/40 border-blue-500/30'
                      : 'bg-slate-800/50 border-slate-700/50'
                  }`}
                >
                  {colTasks.map((task, index) => (
                    <Draggable key={task.id} draggableId={task.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <BoardCard
                            task={task}
                            isDragging={snapshot.isDragging}
                            projectName={getProjectName(task)}
                            onTaskUpdate={onTaskUpdate}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {colTasks.length === 0 && !snapshot.isDraggingOver && (
                    <div className="text-center py-8 text-gray-600 text-xs">
                      No tasks
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        );
      })}
    </div>
  );
}

// ── Board Card ─────────────────────────────────────────

function BoardCard({
  task,
  isDragging,
  projectName,
  onTaskUpdate,
}: {
  task: Task;
  isDragging: boolean;
  projectName: string;
  onTaskUpdate: (id: string, field: 'priority' | 'status', value: string) => void;
}) {
  return (
    <div className={`p-3 rounded-lg border bg-slate-800 transition-all duration-200 ${
      isDragging ? 'border-blue-500/50 shadow-xl shadow-blue-500/10 scale-[1.02]' : 'border-slate-700 hover:border-slate-600'
    }`}>
      <div className="text-sm text-gray-200 mb-2 leading-relaxed">{task.title}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <EditablePriority priority={task.priority} small onChange={v => onTaskUpdate(task.id, 'priority', v)} />
        {task.task_type && (
          <span className="px-1.5 py-0.5 text-xs rounded bg-slate-700 text-gray-400">{task.task_type}</span>
        )}
        {projectName && (
          <span className="text-xs text-gray-500 truncate max-w-[120px]">{projectName}</span>
        )}
      </div>
      <div className="text-xs text-gray-600 mt-2">{formatRelativeTime(task.created_at)}</div>
    </div>
  );
}

// ── Sortable Header ────────────────────────────────────

function SortableHeader({
  field,
  label,
  flex,
  width,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  flex?: string;
  width?: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`${flex || ''} ${width || ''} flex items-center gap-1 px-3 py-2.5 text-left hover:text-gray-200 transition-colors flex-shrink-0 ${
        active ? 'text-gray-200' : ''
      }`}
    >
      <span>{label}</span>
      {active ? (
        sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-30" />
      )}
    </button>
  );
}

// ── Stat Badge ─────────────────────────────────────────

function StatBadge({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${bg}`}>
      <span className={`text-lg font-bold ${color}`}>{count}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Inline Editable Priority ───────────────────────────

function EditablePriority({ priority, small, onChange }: { priority: string; small?: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        className={`${small ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'} rounded cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${priorityColor(priority)}`}
      >
        {priority}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[60px] animate-in fade-in slide-in-from-top-2 duration-200">
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={e => { e.stopPropagation(); onChange(p); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-xs text-left hover:bg-slate-700 transition-colors ${p === priority ? 'font-bold' : ''} ${priorityColor(p)}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline Editable Status ─────────────────────────────

function EditableStatus({ status, options, onChange }: { status: string; options: readonly string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        className={`px-2 py-0.5 text-xs rounded cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${statusColor(status)}`}
      >
        {status}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[100px] animate-in fade-in slide-in-from-top-2 duration-200">
          {options.map(s => (
            <button
              key={s}
              onClick={e => { e.stopPropagation(); onChange(s); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-xs text-left hover:bg-slate-700 transition-colors ${s === status ? 'font-bold' : ''} ${statusColor(s)}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
