import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderKanban,
  RefreshCw,
  Target,
  ListTodo,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus
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
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  project_id?: string;
}

function StatusBadge({ status }: { status: string }) {
  const colorClass = status === 'active'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'completed'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    : status === 'archived'
    ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';

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

function ProjectCard({
  project,
  linkedGoal,
  taskCount,
  activeTaskCount,
}: {
  project: Project;
  linkedGoal?: Goal;
  taskCount: number;
  activeTaskCount: number;
}) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <FolderKanban className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1">
                {project.description}
              </p>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4 text-sm mb-3">
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <ListTodo className="w-4 h-4" />
          <span>{taskCount} tasks</span>
        </div>
        {activeTaskCount > 0 && (
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <Clock className="w-4 h-4" />
            <span>{activeTaskCount} active</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
        <StatusBadge status={project.status} />
        {linkedGoal && (
          <div className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400">
            <Target className="w-3.5 h-3.5" />
            <span className="truncate max-w-[150px]">{linkedGoal.title}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Ref for refresh function (set after fetchData is defined)
  const refreshRef = useRef<() => void>(() => {});

  // Filter actions for Cecelia
  const setStatusFilter = useCallback((value: string) => {
    if (value === 'all' || value === 'active' || value === 'completed') {
      setFilter(value);
    }
  }, []);

  // Page actions for Cecelia
  const pageActions = useMemo(() => ({
    refresh: () => refreshRef.current(),
    setFilter: (_name: string, value: string) => setStatusFilter(value),
    setFilter_status: (_name: string, value: string) => setStatusFilter(value),
  }), [setStatusFilter]);

  // Register with Cecelia
  const { register, unregisterPage } = useCeceliaPage(
    'projects',
    'Projects Dashboard',
    () => projects,
    () => ({ filter, loading }),
    pageActions,
    () => {
      const active = projects.filter(p => p.status === 'active').length;
      const completed = projects.filter(p => p.status === 'completed').length;
      const totalTasks = tasks.length;
      return `${projects.length} projects (${active} active, ${completed} completed), ${totalTasks} tasks`;
    }
  );

  // Update registration when data changes
  useEffect(() => {
    register();
    return () => unregisterPage();
  }, [register, unregisterPage, projects, tasks, filter, loading]);

  const fetchData = useCallback(async () => {
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

      setProjects(projectsData);
      setGoals(goalsData);
      setTasks(tasksData);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  // Set the refresh ref so Cecelia can trigger refresh
  refreshRef.current = handleRefresh;

  const filteredProjects = projects.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'active') return p.status === 'active';
    if (filter === 'completed') return p.status === 'completed';
    return true;
  });

  const getLinkedGoal = (goalId?: string) => {
    if (!goalId) return undefined;
    return goals.find(g => g.id === goalId);
  };

  const getTaskCount = (projectId: string) => {
    return tasks.filter(t => t.project_id === projectId).length;
  };

  const getActiveTaskCount = (projectId: string) => {
    return tasks.filter(t => t.project_id === projectId && t.status === 'in_progress').length;
  };

  // Stats
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;
  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
            <FolderKanban className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Projects</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Manage your projects and tasks</p>
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

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FolderKanban className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{projects.length}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total Projects</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeProjects}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Target className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{completedProjects}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <ListTodo className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeTasks}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Active Tasks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'active', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'all' && <span className="ml-1.5 text-xs">({projects.length})</span>}
            {f === 'active' && <span className="ml-1.5 text-xs">({activeProjects})</span>}
            {f === 'completed' && <span className="ml-1.5 text-xs">({completedProjects})</span>}
          </button>
        ))}
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg" />
                <div className="flex-1">
                  <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
                </div>
              </div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700">
          <FolderKanban className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400">No projects found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              linkedGoal={getLinkedGoal(project.goal_id)}
              taskCount={getTaskCount(project.id)}
              activeTaskCount={getActiveTaskCount(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
