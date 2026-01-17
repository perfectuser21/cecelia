/**
 * EngineDashboard - Engine 工作台首页
 * 显示最近开发活动、当前任务、系统状态
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  GitBranch,
  CheckCircle2,
  Clock,
  AlertCircle,
  Cpu,
  Code,
  Workflow,
  ArrowRight,
  RefreshCw,
  Terminal,
  Zap,
} from 'lucide-react';
import { getAllTasks, type DevTaskStatus } from '../api/dev-tracker.api';
import { getEngineInfo, type EngineInfo } from '../api/engine.api';

interface RecentActivity {
  id: string;
  type: 'commit' | 'pr' | 'task_start' | 'task_complete' | 'ci_pass' | 'ci_fail';
  title: string;
  project: string;
  time: string;
  branch?: string;
}

export default function EngineDashboard() {
  const [tasks, setTasks] = useState<DevTaskStatus[]>([]);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [tasksRes, engineRes] = await Promise.all([getAllTasks(), getEngineInfo()]);

      if (tasksRes.success && tasksRes.data) {
        setTasks(tasksRes.data);
      }
      if (engineRes.success && engineRes.engine) {
        setEngineInfo(engineRes.engine);
      }
    } catch (e) {
      console.error('Failed to fetch dashboard data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  // 从任务生成最近活动
  const recentActivities: RecentActivity[] = tasks
    .flatMap((task) => {
      const activities: RecentActivity[] = [];
      const { repo, task: taskInfo, steps, quality } = task;

      if (taskInfo.createdAt) {
        activities.push({
          id: `${repo.name}-start`,
          type: 'task_start',
          title: `开始任务: ${taskInfo.name || task.branches.current}`,
          project: repo.name,
          time: taskInfo.createdAt,
          branch: task.branches.current,
        });
      }

      steps.items
        .filter((s) => s.status === 'done' && s.completedAt)
        .forEach((step) => {
          activities.push({
            id: `${repo.name}-step-${step.id}`,
            type: 'task_complete',
            title: `完成 Step ${step.id}: ${step.name}`,
            project: repo.name,
            time: step.completedAt!,
            branch: task.branches.current,
          });
        });

      if (quality.ci === 'passed') {
        activities.push({
          id: `${repo.name}-ci-pass`,
          type: 'ci_pass',
          title: 'CI 检查通过',
          project: repo.name,
          time: quality.lastCheck,
          branch: task.branches.current,
        });
      } else if (quality.ci === 'failed') {
        activities.push({
          id: `${repo.name}-ci-fail`,
          type: 'ci_fail',
          title: 'CI 检查失败',
          project: repo.name,
          time: quality.lastCheck,
          branch: task.branches.current,
        });
      }

      if (taskInfo.prUrl) {
        activities.push({
          id: `${repo.name}-pr`,
          type: 'pr',
          title: `创建 PR #${taskInfo.prNumber}`,
          project: repo.name,
          time: taskInfo.createdAt,
          branch: task.branches.current,
        });
      }

      return activities;
    })
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 10);

  // 统计数据
  const stats = {
    activeTasks: tasks.filter((t) => t.steps.current > 0 && t.steps.current < 10).length,
    completedToday: tasks.filter((t) => {
      const allDone = t.steps.items.every((s) => s.status === 'done' || s.status === 'skipped');
      if (!allDone) return false;
      const lastStep = t.steps.items.find((s) => s.status === 'done' && s.completedAt);
      if (!lastStep?.completedAt) return false;
      const today = new Date().toDateString();
      return new Date(lastStep.completedAt).toDateString() === today;
    }).length,
    failedTasks: tasks.filter((t) => t.quality.ci === 'failed' || t.steps.items.some((s) => s.status === 'failed'))
      .length,
    totalRepos: new Set(tasks.map((t) => t.repo.name)).size,
  };

  const getActivityIcon = (type: RecentActivity['type']) => {
    switch (type) {
      case 'commit':
        return <GitBranch className="w-4 h-4 text-blue-500" />;
      case 'pr':
        return <GitBranch className="w-4 h-4 text-purple-500" />;
      case 'task_start':
        return <Zap className="w-4 h-4 text-cyan-500" />;
      case 'task_complete':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'ci_pass':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'ci_fail':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatTime = (time: string) => {
    const date = new Date(time);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部欢迎栏 */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 border border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Engine 工作台</h1>
            <p className="text-slate-400">
              {new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {engineInfo && (
              <div className="text-right">
                <p className="text-sm text-slate-400">Engine 版本</p>
                <p className="text-lg font-mono text-cyan-400">v{engineInfo.version}</p>
              </div>
            )}
            <div className="p-3 bg-cyan-500/20 rounded-xl">
              <Cpu className="w-8 h-8 text-cyan-400" />
            </div>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg">
              <Activity className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">进行中</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.activeTasks}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">今日完成</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.completedToday}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">需关注</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.failedTasks}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">活跃仓库</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalRepos}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 最近活动 */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-cyan-500" />
              最近活动
            </h2>
            <Link
              to="/engine/dev"
              className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
            >
              查看全部 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {recentActivities.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>暂无最近活动</p>
                <p className="text-sm mt-1">开始一个新任务吧</p>
              </div>
            ) : (
              recentActivities.map((activity) => (
                <div key={activity.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{activity.title}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                          {activity.project}
                        </span>
                        {activity.branch && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {activity.branch}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{formatTime(activity.time)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧栏 */}
        <div className="space-y-4">
          {/* 当前任务 */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-500" />
              进行中的任务
            </h3>
            {tasks.filter((t) => t.steps.current > 0 && t.steps.current < 10).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">暂无进行中的任务</p>
            ) : (
              <div className="space-y-2">
                {tasks
                  .filter((t) => t.steps.current > 0 && t.steps.current < 10)
                  .slice(0, 3)
                  .map((task) => (
                    <Link
                      key={task.repo.name}
                      to="/engine/dev"
                      className="block p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {task.task.name || task.branches.current}
                        </span>
                        <span className="text-xs text-slate-500">Step {task.steps.current}/10</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 transition-all"
                          style={{ width: `${(task.steps.current / 10) * 100}%` }}
                        />
                      </div>
                    </Link>
                  ))}
              </div>
            )}
          </div>

          {/* 快捷入口 */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">快捷入口</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/engine"
                className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Cpu className="w-4 h-4 text-cyan-500" />
                <span className="text-sm text-slate-700 dark:text-slate-300">能力概览</span>
              </Link>
              <Link
                to="/engine/tasks"
                className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Activity className="w-4 h-4 text-purple-500" />
                <span className="text-sm text-slate-700 dark:text-slate-300">任务监控</span>
              </Link>
              <Link
                to="/engine/dev"
                className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Code className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-slate-700 dark:text-slate-300">开发任务</span>
              </Link>
              <Link
                to="/cecilia"
                className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Workflow className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Cecilia</span>
              </Link>
            </div>
          </div>

          {/* Engine 能力 */}
          {engineInfo && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                Engine 能力
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Skills</span>
                  <span className="font-medium text-slate-900 dark:text-white">{engineInfo.skills.length} 个</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Hooks</span>
                  <span className="font-medium text-slate-900 dark:text-white">{engineInfo.hooks.length} 个</span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>最近更新</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {engineInfo.changelog[0]?.date || '-'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
