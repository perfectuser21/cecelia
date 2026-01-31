import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  FolderKanban,
  RefreshCw,
  Target,
  ListTodo,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  GitBranch
} from 'lucide-react';
import { useCeceliaPage } from '../../../../dashboard/frontend/src/contexts/CeceliaContext';

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  repo_path?: string;
  goal_id?: string;
}

interface Goal {
  id: string;
  title: string;
  priority: string;
  progress: number;
  status: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  description?: string;
  project_id?: string;
  goal_id?: string;
}

function StatusBadge({ status }: { status: string }) {
  const colorClass = status === 'active' || status === 'in_progress'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'completed'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    : status === 'pending' || status === 'queued'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
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

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [linkedGoal, setLinkedGoal] = useState<Goal | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'P0' | 'P1' | 'P2'>('all');

  // Ref for refresh function (set after fetchData is defined)
  const refreshRef = useRef<() => void>(() => {});

  // Filter setters for Cecelia
  const handleSetStatusFilter = useCallback((value: string) => {
    if (value === 'all' || value === 'pending' || value === 'in_progress' || value === 'completed') {
      setStatusFilter(value);
    }
  }, []);

  const handleSetPriorityFilter = useCallback((value: string) => {
    if (value === 'all' || value === 'P0' || value === 'P1' || value === 'P2') {
      setPriorityFilter(value);
    }
  }, []);

  // Page actions for Cecelia
  const pageActions = useMemo(() => ({
    refresh: () => refreshRef.current(),
    setFilter: (name: string, value: string) => {
      if (name === 'status') handleSetStatusFilter(value);
      if (name === 'priority') handleSetPriorityFilter(value);
    },
    setFilter_status: (_name: string, value: string) => handleSetStatusFilter(value),
    setFilter_priority: (_name: string, value: string) => handleSetPriorityFilter(value),
    goBack: () => navigate('/projects'),
    goToOkr: () => navigate('/okr'),
  }), [handleSetStatusFilter, handleSetPriorityFilter, navigate]);

  // Register with Cecelia
  const { register, unregisterPage } = useCeceliaPage(
    'project-detail',
    project ? `Project: ${project.name}` : 'Project Detail',
    () => ({ project, linkedGoal, tasks }),
    () => ({ statusFilter, priorityFilter, loading }),
    pageActions,
    () => {
      if (!project) return 'Loading project...';
      const pending = tasks.filter(t => t.status === 'pending' || t.status === 'queued').length;
      const active = tasks.filter(t => t.status === 'in_progress').length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      return `${project.name} - ${tasks.length} tasks (${pending} pending, ${active} active, ${completed} done)`;
    }
  );

  // Update registration when data changes
  useEffect(() => {
    register();
    return () => unregisterPage();
  }, [register, unregisterPage, project, linkedGoal, tasks, statusFilter, priorityFilter, loading]);

  const fetchData = useCallback(async () => {
    if (!projectId) return;

    try {
      const [projectsRes, goalsRes, tasksRes] = await Promise.all([
        fetch('/api/tasks/projects'),
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/tasks?limit=100')
      ]);

      const [projectsData, goalsData, tasksData] = await Promise.all([
        projectsRes.json(),
        goalsRes.json(),
        tasksRes.json()
      ]);

      const foundProject = projectsData.find((p: Project) => p.id === projectId);
      setProject(foundProject || null);

      if (foundProject?.goal_id) {
        const goal = goalsData.find((g: Goal) => g.id === foundProject.goal_id);
        setLinkedGoal(goal || null);
      }

      const projectTasks = tasksData.filter((t: Task) => t.project_id === projectId);
      setTasks(projectTasks);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  // Set the refresh ref so Cecelia can trigger refresh
  refreshRef.current = handleRefresh;

  const filteredTasks = tasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    return true;
  });

  // Stats
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'queued').length;
  const activeTasks = tasks.filter(t => t.status === 'in_progress').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="flex-1">
            <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-2" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <FolderKanban className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
        <p className="text-slate-500 dark:text-slate-400">Project not found</p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button & Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/projects')}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex items-center gap-3 flex-1">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
            <FolderKanban className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{project.description}</p>
            )}
          </div>
          <StatusBadge status={project.status} />
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Project Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Linked OKR */}
        {linkedGoal && (
          <Link
            to="/okr"
            className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20 rounded-xl p-4 border border-violet-200 dark:border-violet-800 hover:border-violet-400 dark:hover:border-violet-600 transition-colors group"
          >
            <div className="flex items-center gap-3 mb-2">
              <Target className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Part of OKR</span>
              <ChevronRight className="w-4 h-4 text-violet-400 ml-auto group-hover:translate-x-1 transition-transform" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white">{linkedGoal.title}</h3>
            <div className="flex items-center gap-3 mt-2 text-sm">
              <PriorityBadge priority={linkedGoal.priority} />
              <span className="text-violet-600 dark:text-violet-400">{linkedGoal.progress}% complete</span>
            </div>
          </Link>
        )}

        {/* Repo Path */}
        {project.repo_path && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="w-5 h-5 text-slate-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Repository</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-mono truncate">
              {project.repo_path}
            </p>
          </div>
        )}
      </div>

      {/* Task Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
              <ListTodo className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{tasks.length}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total Tasks</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{pendingTasks}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeTasks}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{completedTasks}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Tasks</h2>
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as any)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">All Priority</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
            </select>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700">
            <ListTodo className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 dark:text-slate-400">No tasks in this project</p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700">
            <ListTodo className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 dark:text-slate-400">No tasks match the current filters</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {filteredTasks.map((task) => (
              <div
                key={task.id}
                className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={task.status} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-900 dark:text-white truncate">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1">
                        {task.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <StatusBadge status={task.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
