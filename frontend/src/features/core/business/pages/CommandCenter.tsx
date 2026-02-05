/**
 * CommandCenter - 统一控制中心（层级导航版）
 *
 * 支持下钻导航：
 * /command - 总览
 * /command/okr - OKR 列表
 * /command/projects - Projects 列表
 * /command/tasks - Tasks 列表
 * /command/vps - VPS 详情
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, Routes, Route, Link } from 'react-router-dom';
import {
  Share2, Briefcase, TrendingUp, ChevronRight, ChevronDown,
  Target, CheckCircle2, Circle, Play, Clock, Server, Cpu,
  Home, ListTodo, Folder, Activity
} from 'lucide-react';

interface Goal {
  id: string;
  title: string;
  status: string;
  progress: number;
  parent_id?: string;
  priority?: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  goal_id: string;
  project_id?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  started_at?: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  repo_path?: string;
  parent_id?: string;
}

interface BrainStatus {
  daily_focus?: {
    objective_id: string;
    objective_title: string;
    key_results: Array<{ id: string; title: string; progress: number }>;
  };
  system_health?: {
    open_tasks_total: number;
  };
}

interface TickStatus {
  enabled: boolean;
  actions_today: number;
}

interface VpsSlot {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  taskId: string | null;
  command: string;
}

// Breadcrumb component
function Breadcrumb({ items }: { items: Array<{ label: string; path?: string }> }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-6">
      <Link to="/command" className="hover:text-blue-500 flex items-center gap-1">
        <Home className="w-4 h-4" />
        <span>Command Center</span>
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4" />
          {item.path ? (
            <Link to={item.path} className="hover:text-blue-500">{item.label}</Link>
          ) : (
            <span className="text-slate-700 dark:text-slate-200">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Summary Card component
function SummaryCard({
  icon: Icon,
  title,
  subtitle,
  onClick,
  color = 'blue',
  children
}: {
  icon: any;
  title: string;
  subtitle: string;
  value?: string | number;
  onClick?: () => void;
  color?: string;
  children?: React.ReactNode;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-500',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-500',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500',
    cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-500',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-500',
  };

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-left w-full transition-all ${
        onClick ? 'hover:border-blue-300 hover:shadow-lg cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-800 dark:text-white">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {onClick && <ChevronRight className="w-5 h-5 text-slate-400" />}
      </div>
      {children}
    </button>
  );
}

// ==================== Overview Page ====================
function OverviewPage({
  brainStatus,
  tickStatus,
  goals,
  tasks,
  projects,
  vpsSlots,
  runningTasks,
  navigate
}: any) {
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());

  const toggleGoal = (goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      if (next.has(goalId)) {
        next.delete(goalId);
      } else {
        next.add(goalId);
      }
      return next;
    });
  };

  const getTasksForGoal = (goalId: string) => {
    return tasks.filter((t: Task) => t.goal_id === goalId);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'in_progress':
        return <Play className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'queued':
        return <Clock className="w-4 h-4 text-amber-500" />;
      default:
        return <Circle className="w-4 h-4 text-slate-400" />;
    }
  };

  const getTaskStats = (goalId: string) => {
    const goalTasks = getTasksForGoal(goalId);
    const total = goalTasks.length;
    const completed = goalTasks.filter((t: Task) => t.status === 'completed').length;
    return { total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
  };

  // 计算今日统计
  const getTodayStats = () => {
    const today = new Date().toDateString();
    const todayCompleted = tasks.filter((t: Task) => {
      if (t.status !== 'completed' || !t.completed_at) return false;
      return new Date(t.completed_at).toDateString() === today;
    }).length;
    const todayStarted = tasks.filter((t: Task) => {
      if (!t.started_at) return false;
      return new Date(t.started_at).toDateString() === today;
    }).length;
    return { todayCompleted, todayStarted };
  };

  const todayStats = getTodayStats();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Command Center</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">统一控制中心</p>
      </div>

      {/* Top Row: VPS + Execution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* VPS Status */}
        <SummaryCard
          icon={Server}
          title="VPS 状态"
          subtitle="Claude 并发槽位"
          color="cyan"
          onClick={() => navigate('/command/vps')}
        >
          <div className="flex gap-2 mb-3">
            {Array.from({ length: vpsSlots.total }).map((_: any, i: number) => {
              const slot = vpsSlots.slots?.[i];
              return (
                <div
                  key={i}
                  className={`flex-1 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all ${
                    slot
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                  }`}
                  title={slot ? `PID: ${slot.pid}\nCPU: ${slot.cpu}\nMem: ${slot.memory}` : '空闲'}
                >
                  {slot ? <Cpu className="w-4 h-4" /> : ''}
                </div>
              );
            })}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-bold text-blue-500">{vpsSlots.used}</span> / {vpsSlots.total} 槽位使用中
            {vpsSlots.slots?.length > 0 && <span className="ml-2 text-xs text-slate-400">(真实进程)</span>}
          </p>
        </SummaryCard>

        {/* Today Stats + Current Execution */}
        <SummaryCard
          icon={Play}
          title="今日执行"
          subtitle={`Tick: ${tickStatus?.enabled ? '已启用' : '已禁用'}`}
          color="blue"
          onClick={() => navigate('/command/execution')}
        >
          {/* Today Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{todayStats.todayCompleted}</p>
              <p className="text-xs text-slate-500">今日完成</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{todayStats.todayStarted}</p>
              <p className="text-xs text-slate-500">今日启动</p>
            </div>
          </div>
          {/* Running Tasks */}
          {runningTasks.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 font-medium">执行中:</p>
              {runningTasks.slice(0, 2).map((task: Task) => (
                <div key={task.id} className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2">
                    <Play className="w-3 h-3 text-blue-500 animate-pulse" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                      {task.title.slice(0, 35)}...
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-xs">暂无执行中的任务</p>
          )}
        </SummaryCard>
      </div>

      {/* OKR Summary Card */}
      <SummaryCard
        icon={Target}
        title="OKR 目标"
        subtitle="点击展开查看详情"
        color="purple"
        onClick={() => navigate('/command/okr')}
      >
        {brainStatus?.daily_focus && (
          <div className="space-y-3">
            <button
              onClick={(e) => { e.stopPropagation(); toggleGoal(brainStatus.daily_focus!.objective_id); }}
              className="w-full text-left p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 hover:border-purple-400 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {expandedGoals.has(brainStatus.daily_focus.objective_id) ? (
                    <ChevronDown className="w-5 h-5 text-purple-500" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-purple-500" />
                  )}
                  <span className="font-medium text-slate-800 dark:text-white">
                    {brainStatus.daily_focus.objective_title}
                  </span>
                </div>
                <span className="text-xs px-2 py-1 bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-200 rounded-full">
                  P0 Focus
                </span>
              </div>
            </button>

            {expandedGoals.has(brainStatus.daily_focus.objective_id) && (
              <div className="ml-6 space-y-2">
                {brainStatus.daily_focus.key_results.map((kr: any) => {
                  const stats = getTaskStats(kr.id);
                  return (
                    <div key={kr.id}>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGoal(kr.id); }}
                        className="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {expandedGoals.has(kr.id) ? (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                            <span className="text-sm text-slate-700 dark:text-slate-200">{kr.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">{stats.completed}/{stats.total} tasks</span>
                            <div className="w-16 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${stats.percent}%` }} />
                            </div>
                          </div>
                        </div>
                      </button>

                      {expandedGoals.has(kr.id) && (
                        <div className="ml-6 mt-2 space-y-1">
                          {getTasksForGoal(kr.id).map((task: Task) => (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/30 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); navigate(`/command/tasks/${task.id}`); }}
                            >
                              {getStatusIcon(task.status)}
                              <span className={`text-sm flex-1 ${
                                task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'
                              }`}>
                                {task.title.slice(0, 50)}...
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                task.priority === 'P1' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                              }`}>
                                {task.priority}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Summary Stats */}
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex gap-6">
          <div>
            <span className="text-2xl font-bold text-slate-800 dark:text-white">
              {tasks.filter((t: Task) => t.status === 'queued').length}
            </span>
            <span className="text-sm text-slate-500 ml-2">待执行</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-blue-500">
              {tasks.filter((t: Task) => t.status === 'in_progress').length}
            </span>
            <span className="text-sm text-slate-500 ml-2">执行中</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-emerald-500">
              {tasks.filter((t: Task) => t.status === 'completed').length}
            </span>
            <span className="text-sm text-slate-500 ml-2">已完成</span>
          </div>
        </div>
      </SummaryCard>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          onClick={() => navigate('/command/tasks')}
          className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:shadow-lg transition-all text-left"
        >
          <ListTodo className="w-6 h-6 text-blue-500 mb-2" />
          <h3 className="font-medium text-slate-800 dark:text-white">Tasks</h3>
          <p className="text-xs text-slate-500">{tasks.length} 个任务</p>
        </button>

        <button
          onClick={() => navigate('/command/projects')}
          className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 hover:shadow-lg transition-all text-left"
        >
          <Folder className="w-6 h-6 text-emerald-500 mb-2" />
          <h3 className="font-medium text-slate-800 dark:text-white">Projects</h3>
          <p className="text-xs text-slate-500">{projects.length} 个项目</p>
        </button>

        <button
          onClick={() => navigate('/command/execution')}
          className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-purple-300 hover:shadow-lg transition-all text-left"
        >
          <Activity className="w-6 h-6 text-purple-500 mb-2" />
          <h3 className="font-medium text-slate-800 dark:text-white">Execution</h3>
          <p className="text-xs text-slate-500">执行历史</p>
        </button>

        <button
          disabled
          className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed text-left"
        >
          <TrendingUp className="w-6 h-6 text-amber-500 mb-2" />
          <h3 className="font-medium text-slate-800 dark:text-white">Analytics</h3>
          <p className="text-xs text-slate-500">Coming soon</p>
        </button>
      </div>
    </div>
  );
}

// ==================== OKR List Page ====================
function OKRListPage({ goals, tasks, navigate }: any) {
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());

  const objectives = goals.filter((g: Goal) => !g.parent_id);
  const keyResults = goals.filter((g: Goal) => g.parent_id);

  const toggleGoal = (goalId: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      next.has(goalId) ? next.delete(goalId) : next.add(goalId);
      return next;
    });
  };

  const getKRsForObjective = (objectiveId: string) => keyResults.filter((kr: Goal) => kr.parent_id === objectiveId);
  const getTasksForGoal = (goalId: string) => tasks.filter((t: Task) => t.goal_id === goalId);

  return (
    <div>
      <Breadcrumb items={[{ label: 'OKR 目标' }]} />

      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">OKR 目标</h1>

      <div className="space-y-4">
        {objectives.map((obj: Goal) => {
          const krs = getKRsForObjective(obj.id);
          const totalTasks = krs.reduce((sum: number, kr: Goal) => sum + getTasksForGoal(kr.id).length, 0);
          const completedTasks = krs.reduce((sum: number, kr: Goal) =>
            sum + getTasksForGoal(kr.id).filter((t: Task) => t.status === 'completed').length, 0);

          // Calculate O progress = average of KR progresses
          const krProgresses = krs.map((kr: Goal) => {
            const krTasks = getTasksForGoal(kr.id);
            return krTasks.length > 0 ? (krTasks.filter((t: Task) => t.status === 'completed').length / krTasks.length) * 100 : 0;
          });
          const oProgress = krProgresses.length > 0 ? Math.round(krProgresses.reduce((a, b) => a + b, 0) / krProgresses.length) : 0;

          return (
            <div key={obj.id} className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => toggleGoal(obj.id)}
                className="w-full p-6 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {expandedGoals.has(obj.id) ? <ChevronDown className="w-5 h-5 text-purple-500" /> : <ChevronRight className="w-5 h-5 text-purple-500" />}
                    <Target className="w-5 h-5 text-purple-500" />
                    <span className="font-semibold text-slate-800 dark:text-white">{obj.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500">{completedTasks}/{totalTasks} tasks</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      obj.priority === 'P0' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {obj.priority || 'P1'}
                    </span>
                  </div>
                </div>
                {/* Objective Progress Bar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-3 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all"
                      style={{ width: `${oProgress}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-purple-600 dark:text-purple-400 w-12 text-right">{oProgress}%</span>
                </div>
              </button>

              {expandedGoals.has(obj.id) && (
                <div className="px-6 pb-6 space-y-3">
                  {krs.map((kr: Goal) => {
                    const krTasks = getTasksForGoal(kr.id);
                    return (
                      <div key={kr.id} className="ml-8">
                        <button
                          onClick={() => toggleGoal(kr.id)}
                          className="w-full p-4 rounded-xl bg-slate-50 dark:bg-slate-700/50 text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {expandedGoals.has(kr.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              <span className="text-slate-700 dark:text-slate-200">{kr.title}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">
                                {krTasks.filter((t: Task) => t.status === 'completed').length}/{krTasks.length}
                              </span>
                              <div className="w-20 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500"
                                  style={{ width: `${krTasks.length ? (krTasks.filter((t: Task) => t.status === 'completed').length / krTasks.length * 100) : 0}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </button>

                        {expandedGoals.has(kr.id) && (
                          <div className="ml-6 mt-2 space-y-1">
                            {krTasks.map((task: Task) => (
                              <div
                                key={task.id}
                                onClick={() => navigate(`/command/tasks/${task.id}`)}
                                className="flex items-center gap-2 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600/50 cursor-pointer"
                              >
                                {task.status === 'completed' ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                ) : task.status === 'in_progress' ? (
                                  <Play className="w-4 h-4 text-blue-500 animate-pulse" />
                                ) : (
                                  <Circle className="w-4 h-4 text-slate-400" />
                                )}
                                <span className={`flex-1 text-sm ${task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                  {task.title}
                                </span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  task.priority === 'P1' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {task.priority}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== Projects List Page ====================
function ProjectsListPage({ projects, tasks, navigate }: any) {
  const topLevelProjects = projects.filter((p: Project) => !p.parent_id);

  const getProjectStats = (projectId: string) => {
    const projectTasks = tasks.filter((t: Task) => t.project_id === projectId);
    const total = projectTasks.length;
    const completed = projectTasks.filter((t: Task) => t.status === 'completed').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, completionRate };
  };

  return (
    <div>
      <Breadcrumb items={[{ label: 'Projects' }]} />

      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Projects</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topLevelProjects.map((project: Project) => {
          const stats = getProjectStats(project.id);
          return (
            <button
              key={project.id}
              onClick={() => navigate(`/command/projects/${project.id}`)}
              className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-left hover:border-emerald-300 hover:shadow-lg transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Folder className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-800 dark:text-white">{project.name}</h3>
                  {project.repo_path && (
                    <p className="text-xs text-slate-500 truncate">{project.repo_path}</p>
                  )}
                </div>
              </div>
              {project.description && (
                <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2 mb-3">{project.description}</p>
              )}
              {/* Task Stats */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {stats.completed}/{stats.total} tasks
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${stats.completionRate}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{stats.completionRate}%</span>
                </div>
              </div>
            </button>
          );
        })}

        {topLevelProjects.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-500">
            暂无项目
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Tasks List Page ====================
function TasksListPage({ tasks, projects, navigate }: any) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [groupByProject, setGroupByProject] = useState<boolean>(true);

  // Apply filters
  const filteredTasks = tasks.filter((t: Task) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    // Handle unassigned project filter correctly
    if (projectFilter === 'unassigned') {
      if (t.project_id) return false;
    } else if (projectFilter !== 'all' && t.project_id !== projectFilter) {
      return false;
    }
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    return true;
  });

  // Group by project
  const tasksByProject = filteredTasks.reduce((acc: Record<string, Task[]>, task: Task) => {
    const projectId = task.project_id || 'unassigned';
    if (!acc[projectId]) acc[projectId] = [];
    acc[projectId].push(task);
    return acc;
  }, {});

  const getProjectName = (projectId: string) => {
    if (projectId === 'unassigned') return '未分配';
    const project = projects.find((p: Project) => p.id === projectId);
    return project?.name || projectId.slice(0, 8);
  };

  const statusCounts = {
    all: tasks.length,
    queued: tasks.filter((t: Task) => t.status === 'queued').length,
    in_progress: tasks.filter((t: Task) => t.status === 'in_progress').length,
    completed: tasks.filter((t: Task) => t.status === 'completed').length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'in_progress': return <Play className="w-4 h-4 text-blue-500 animate-pulse" />;
      default: return <Clock className="w-4 h-4 text-amber-500" />;
    }
  };

  const TaskItem = ({ task }: { task: Task }) => (
    <button
      onClick={() => navigate(`/command/tasks/${task.id}`)}
      className="w-full p-3 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-left hover:border-blue-300 transition-all"
    >
      <div className="flex items-center gap-3">
        {getStatusIcon(task.status)}
        <span className={`flex-1 text-sm ${task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
          {task.title}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          task.priority === 'P0' ? 'bg-red-200 text-red-700' :
          task.priority === 'P1' ? 'bg-orange-100 text-orange-600' :
          'bg-slate-100 text-slate-500'
        }`}>
          {task.priority}
        </span>
      </div>
    </button>
  );

  return (
    <div>
      <Breadcrumb items={[{ label: 'Tasks' }]} />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Tasks</h1>
        <button
          onClick={() => setGroupByProject(!groupByProject)}
          className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
            groupByProject ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600'
          }`}
        >
          {groupByProject ? 'Grouped' : 'Flat'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Status:</span>
          <div className="flex gap-1">
            {(['all', 'queued', 'in_progress', 'completed'] as const).map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-2 py-1 rounded text-xs transition-all ${
                  statusFilter === status
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {status === 'all' ? 'All' : status === 'in_progress' ? 'Running' : status.charAt(0).toUpperCase() + status.slice(1)}
                {status !== 'all' && <span className="ml-1">({statusCounts[status]})</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Project Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Project:</span>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-0"
          >
            <option value="all">All Projects</option>
            {projects.map((p: Project) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="unassigned">Unassigned</option>
          </select>
        </div>

        {/* Priority Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Priority:</span>
          <div className="flex gap-1">
            {['all', 'P0', 'P1', 'P2'].map(priority => (
              <button
                key={priority}
                onClick={() => setPriorityFilter(priority)}
                className={`px-2 py-1 rounded text-xs transition-all ${
                  priorityFilter === priority
                    ? priority === 'P0' ? 'bg-red-500 text-white' :
                      priority === 'P1' ? 'bg-orange-500 text-white' :
                      priority === 'P2' ? 'bg-slate-500 text-white' :
                      'bg-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {priority === 'all' ? 'All' : priority}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tasks List */}
      {groupByProject ? (
        <div className="space-y-6">
          {Object.entries(tasksByProject).map(([projectId, projectTasks]) => (
            <div key={projectId} className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <div className="flex items-center gap-3">
                  <Folder className="w-5 h-5 text-emerald-500" />
                  <span className="font-semibold text-slate-800 dark:text-white">{getProjectName(projectId)}</span>
                  <span className="text-xs text-slate-500">({(projectTasks as Task[]).length} tasks)</span>
                </div>
              </div>
              <div className="p-3 space-y-2">
                {(projectTasks as Task[]).map((task: Task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task: Task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {filteredTasks.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          暂无任务
        </div>
      )}
    </div>
  );
}

// ==================== VPS Detail Page ====================
function VPSDetailPage({ vpsSlots }: { vpsSlots: { used: number; total: number; slots?: VpsSlot[] } }) {
  return (
    <div>
      <Breadcrumb items={[{ label: 'VPS 详情' }]} />

      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">VPS 状态详情</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 mb-1">总槽位</p>
          <p className="text-3xl font-bold text-slate-800 dark:text-white">{vpsSlots.total}</p>
        </div>
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 mb-1">使用中</p>
          <p className="text-3xl font-bold text-blue-500">{vpsSlots.used}</p>
        </div>
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 mb-1">空闲</p>
          <p className="text-3xl font-bold text-emerald-500">{vpsSlots.total - vpsSlots.used}</p>
        </div>
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <p className="text-sm text-slate-500 mb-1">使用率</p>
          <p className="text-3xl font-bold text-purple-500">{Math.round((vpsSlots.used / vpsSlots.total) * 100)}%</p>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">运行中的进程</h2>

      <div className="space-y-3">
        {vpsSlots.slots?.map((slot, i) => (
          <div key={i} className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Cpu className="w-6 h-6 text-blue-500" />
              </div>
              <div className="flex-1 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500">PID</p>
                  <p className="font-mono text-slate-800 dark:text-white">{slot.pid}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">CPU</p>
                  <p className="text-slate-800 dark:text-white">{slot.cpu}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Memory</p>
                  <p className="text-slate-800 dark:text-white">{slot.memory}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">启动时间</p>
                  <p className="text-slate-800 dark:text-white">{slot.startTime}</p>
                </div>
              </div>
            </div>
          </div>
        ))}

        {(!vpsSlots.slots || vpsSlots.slots.length === 0) && (
          <div className="text-center py-12 text-slate-500">
            暂无运行中的 Claude 进程
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main CommandCenter ====================
export default function CommandCenter() {
  const navigate = useNavigate();
  const location = useLocation();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [vpsSlots, setVpsSlots] = useState<{ used: number; total: number; slots?: VpsSlot[] }>({ used: 0, total: 8 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [brainRes, tickRes, goalsRes, tasksRes, projectsRes, vpsRes] = await Promise.all([
        fetch('/api/brain/status'),
        fetch('/api/brain/tick/status'),
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/tasks'),
        fetch('/api/tasks/projects'),
        fetch('/api/brain/vps-slots'),
      ]);

      const [brainData, tickData, goalsData, tasksData, projectsData, vpsData] = await Promise.all([
        brainRes.json(),
        tickRes.json(),
        goalsRes.json(),
        tasksRes.json(),
        projectsRes.json(),
        vpsRes.json(),
      ]);

      setBrainStatus(brainData);
      setTickStatus(tickData);
      setGoals(goalsData || []);
      setTasks(tasksData || []);
      setProjects(projectsData || []);

      const running = (tasksData || []).filter((t: Task) => t.status === 'in_progress');
      setRunningTasks(running);

      if (vpsData.success) {
        setVpsSlots({ used: vpsData.used, total: vpsData.total, slots: vpsData.slots });
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-6xl mx-auto">
        <Routes>
          <Route path="/" element={
            <OverviewPage
              brainStatus={brainStatus}
              tickStatus={tickStatus}
              goals={goals}
              tasks={tasks}
              projects={projects}
              vpsSlots={vpsSlots}
              runningTasks={runningTasks}
              navigate={navigate}
            />
          } />
          <Route path="/okr" element={<OKRListPage goals={goals} tasks={tasks} navigate={navigate} />} />
          <Route path="/projects" element={<ProjectsListPage projects={projects} tasks={tasks} navigate={navigate} />} />
          <Route path="/tasks" element={<TasksListPage tasks={tasks} projects={projects} navigate={navigate} />} />
          <Route path="/vps" element={<VPSDetailPage vpsSlots={vpsSlots} />} />
          <Route path="/execution" element={
            <div>
              <Breadcrumb items={[{ label: 'Execution History' }]} />
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">执行历史</h1>
              <p className="text-slate-500">Coming soon...</p>
            </div>
          } />
          <Route path="/*" element={
            <OverviewPage
              brainStatus={brainStatus}
              tickStatus={tickStatus}
              goals={goals}
              tasks={tasks}
              projects={projects}
              vpsSlots={vpsSlots}
              runningTasks={runningTasks}
              navigate={navigate}
            />
          } />
        </Routes>
      </div>
    </div>
  );
}
