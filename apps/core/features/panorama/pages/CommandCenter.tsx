/**
 * CommandCenter - 统一控制中心
 *
 * 显示：
 * 1. VPS 状态（8个 Claude 槽位）
 * 2. OKR 层级视图（可展开）
 * 3. 当前执行状态
 * 4. 快捷入口卡片
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Share2, Briefcase, TrendingUp, ChevronRight, ChevronDown,
  Target, CheckCircle2, Circle, Play, Clock, Server, Cpu
} from 'lucide-react';

interface Goal {
  id: string;
  title: string;
  status: string;
  progress: number;
  parent_id?: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  goal_id: string;
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

export default function CommandCenter() {
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [vpsSlots, setVpsSlots] = useState<{ used: number; total: number; slots?: Array<{ pid: number; cpu: string; memory: string; startTime: string; taskId: string | null; command: string }> }>({ used: 0, total: 8 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      // Fetch brain status
      const brainRes = await fetch('/api/brain/status');
      const brainData = await brainRes.json();
      setBrainStatus(brainData);

      // Fetch tick status
      const tickRes = await fetch('/api/brain/tick/status');
      const tickData = await tickRes.json();
      setTickStatus(tickData);

      // Fetch all goals
      const goalsRes = await fetch('/api/tasks/goals');
      const goalsData = await goalsRes.json();
      setGoals(goalsData || []);

      // Fetch all tasks
      const tasksRes = await fetch('/api/tasks/tasks');
      const tasksData = await tasksRes.json();
      setTasks(tasksData || []);

      // Calculate running tasks
      const running = (tasksData || []).filter((t: Task) => t.status === 'in_progress');
      setRunningTasks(running);

      // Fetch real VPS slots from API
      try {
        const vpsRes = await fetch('/api/brain/vps-slots');
        const vpsData = await vpsRes.json();
        if (vpsData.success) {
          setVpsSlots({ used: vpsData.used, total: vpsData.total, slots: vpsData.slots });
        }
      } catch {
        // Fallback to running tasks count
        setVpsSlots({ used: running.length, total: 8 });
      }

    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
    return tasks.filter(t => t.goal_id === goalId);
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
    const completed = goalTasks.filter(t => t.status === 'completed').length;
    return { total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Command Center</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">统一控制中心</p>
        </div>

        {/* Top Row: VPS Status + Current Execution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* VPS Status */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                <Server className="w-5 h-5 text-cyan-500" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800 dark:text-white">VPS 状态</h2>
                <p className="text-xs text-slate-500">Claude 并发槽位</p>
              </div>
            </div>

            {/* Slots visualization */}
            <div className="flex gap-2 mb-3">
              {Array.from({ length: vpsSlots.total }).map((_, i) => {
                const slot = vpsSlots.slots?.[i];
                return (
                  <div
                    key={i}
                    className={`flex-1 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all cursor-pointer ${
                      slot
                        ? 'bg-blue-500 text-white animate-pulse hover:bg-blue-600'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                    title={slot ? `PID: ${slot.pid}\nCPU: ${slot.cpu}\nMem: ${slot.memory}\n启动: ${slot.startTime}` : '空闲'}
                  >
                    {slot ? <Cpu className="w-4 h-4" /> : ''}
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-bold text-blue-500">{vpsSlots.used}</span> / {vpsSlots.total} 槽位使用中
              {vpsSlots.slots && vpsSlots.slots.length > 0 && (
                <span className="ml-2 text-xs text-slate-400">(真实进程)</span>
              )}
            </p>
          </div>

          {/* Current Execution */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Play className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800 dark:text-white">当前执行</h2>
                <p className="text-xs text-slate-500">Tick: {tickStatus?.enabled ? '已启用' : '已禁用'}</p>
              </div>
            </div>

            {runningTasks.length > 0 ? (
              <div className="space-y-2">
                {runningTasks.slice(0, 2).map(task => (
                  <div key={task.id} className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2">
                      <Play className="w-4 h-4 text-blue-500 animate-pulse" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                        {task.title.slice(0, 40)}...
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-sm">暂无执行中的任务</p>
            )}

            <div className="mt-3 text-xs text-slate-500">
              今日执行: {tickStatus?.actions_today || 0} 次
            </div>
          </div>
        </div>

        {/* OKR Hierarchy */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Target className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-white">OKR 目标</h2>
              <p className="text-xs text-slate-500">点击展开查看详情</p>
            </div>
          </div>

          {/* Daily Focus Objective */}
          {brainStatus?.daily_focus && (
            <div className="space-y-3">
              {/* Objective */}
              <button
                onClick={() => toggleGoal(brainStatus.daily_focus!.objective_id)}
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

              {/* Key Results */}
              {expandedGoals.has(brainStatus.daily_focus.objective_id) && (
                <div className="ml-6 space-y-2">
                  {brainStatus.daily_focus.key_results.map(kr => {
                    const stats = getTaskStats(kr.id);
                    return (
                      <div key={kr.id}>
                        <button
                          onClick={() => toggleGoal(kr.id)}
                          className="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {expandedGoals.has(kr.id) ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                              <span className="text-sm text-slate-700 dark:text-slate-200">
                                {kr.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">
                                {stats.completed}/{stats.total} tasks
                              </span>
                              <div className="w-16 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 transition-all"
                                  style={{ width: `${stats.percent}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </button>

                        {/* Tasks under KR */}
                        {expandedGoals.has(kr.id) && (
                          <div className="ml-6 mt-2 space-y-1">
                            {getTasksForGoal(kr.id).map(task => (
                              <div
                                key={task.id}
                                className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/30 cursor-pointer"
                                onClick={() => navigate(`/tasks/${task.id}`)}
                              >
                                {getStatusIcon(task.status)}
                                <span className={`text-sm ${
                                  task.status === 'completed'
                                    ? 'text-slate-400 line-through'
                                    : 'text-slate-600 dark:text-slate-300'
                                }`}>
                                  {task.title.slice(0, 50)}...
                                </span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  task.priority === 'P1'
                                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                }`}>
                                  {task.priority}
                                </span>
                              </div>
                            ))}
                            {getTasksForGoal(kr.id).length === 0 && (
                              <p className="text-xs text-slate-400 italic p-2">暂无任务</p>
                            )}
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
                {tasks.filter(t => t.status === 'queued').length}
              </span>
              <span className="text-sm text-slate-500 ml-2">待执行</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-blue-500">
                {tasks.filter(t => t.status === 'in_progress').length}
              </span>
              <span className="text-sm text-slate-500 ml-2">执行中</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-emerald-500">
                {tasks.filter(t => t.status === 'completed').length}
              </span>
              <span className="text-sm text-slate-500 ml-2">已完成</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button
            onClick={() => navigate('/command/ai')}
            className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:shadow-lg transition-all text-left"
          >
            <Bot className="w-6 h-6 text-blue-500 mb-2" />
            <h3 className="font-medium text-slate-800 dark:text-white">AI Workforce</h3>
            <p className="text-xs text-slate-500">Cecelia 执行记录</p>
          </button>

          <button
            onClick={() => navigate('/projects')}
            className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 hover:shadow-lg transition-all text-left"
          >
            <Briefcase className="w-6 h-6 text-emerald-500 mb-2" />
            <h3 className="font-medium text-slate-800 dark:text-white">Projects</h3>
            <p className="text-xs text-slate-500">项目管理</p>
          </button>

          <button
            disabled
            className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed text-left"
          >
            <Share2 className="w-6 h-6 text-purple-500 mb-2" />
            <h3 className="font-medium text-slate-800 dark:text-white">Media</h3>
            <p className="text-xs text-slate-500">Coming soon</p>
          </button>

          <button
            disabled
            className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed text-left"
          >
            <TrendingUp className="w-6 h-6 text-amber-500 mb-2" />
            <h3 className="font-medium text-slate-800 dark:text-white">Portfolio</h3>
            <p className="text-xs text-slate-500">Coming soon</p>
          </button>
        </div>
      </div>
    </div>
  );
}
