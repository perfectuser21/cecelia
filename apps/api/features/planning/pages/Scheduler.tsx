import { useEffect, useState } from 'react';
import {
  Brain,
  RefreshCw,
  XCircle,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Zap,
  Calendar,
  Settings,
  Send,
  Layers,
  Target,
  TrendingUp,
} from 'lucide-react';
import axios from 'axios';

interface Task {
  id: string;
  repo: string;
  prd_file: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  status: 'queued' | 'scheduled' | 'running' | 'completed' | 'blocked';
  estimated_time?: string;
  dependencies?: string[];
}

interface SchedulerState {
  mode: 'auto' | 'manual';
  running: boolean;
  queue: Task[];
  scheduled: Task[];
  executing: Task[];
  completed: Task[];
  capacity: {
    max: number;
    used: number;
    available: number;
  };
}

interface PlannerData {
  pending_work: Array<{
    repo: string;
    file: string;
    path: string;
    title: string;
  }>;
  capacity: {
    max: number;
    used: number;
    available: number;
  };
}

export default function Scheduler() {
  const [scheduler, setScheduler] = useState<SchedulerState>({
    mode: 'manual',
    running: false,
    queue: [],
    scheduled: [],
    executing: [],
    completed: [],
    capacity: { max: 3, used: 0, available: 3 },
  });
  const [plannerData, setPlannerData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  const loadData = async () => {
    try {
      // Load planner data (repos, PRDs)
      const plannerRes = await axios.get('/api/panorama/planner');
      if (plannerRes.data.success) {
        setPlannerData(plannerRes.data.data);

        // Convert pending PRDs to queue tasks
        const queueTasks: Task[] = plannerRes.data.data.pending_work.map((prd: any, idx: number) => ({
          id: `prd-${idx}`,
          repo: prd.repo,
          prd_file: prd.file,
          title: prd.title,
          priority: 'P1' as const,
          status: 'queued' as const,
          estimated_time: '30min',
        }));

        // Load active work as executing
        const executingTasks: Task[] = (plannerRes.data.data.active_work || []).map((work: any, idx: number) => ({
          id: `exec-${idx}`,
          repo: work.project,
          prd_file: 'current',
          title: `Running in ${work.project}`,
          priority: 'P0' as const,
          status: work.status === 'active' ? 'running' : 'scheduled',
          estimated_time: work.runtime,
        }));

        setScheduler(prev => ({
          ...prev,
          queue: queueTasks,
          executing: executingTasks,
          capacity: plannerRes.data.data.capacity,
        }));
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  const setPriority = (taskId: string, priority: 'P0' | 'P1' | 'P2') => {
    setScheduler(prev => ({
      ...prev,
      queue: prev.queue.map(t => t.id === taskId ? { ...t, priority } : t),
    }));
  };

  const moveToScheduled = (taskId: string) => {
    const task = scheduler.queue.find(t => t.id === taskId);
    if (task && scheduler.capacity.available > 0) {
      setScheduler(prev => ({
        ...prev,
        queue: prev.queue.filter(t => t.id !== taskId),
        scheduled: [...prev.scheduled, { ...task, status: 'scheduled' }],
      }));
    }
  };

  const triggerTask = async (task: Task) => {
    try {
      // Trigger via N8N webhook
      const response = await axios.post('/n8n/webhook/cecelia-start', {
        project: task.repo,
        prd_path: task.prd_file,
      });

      if (response.data) {
        alert(`任务已触发: ${task.title}`);
        loadData();
      }
    } catch (e: any) {
      alert(`触发失败: ${e.message}`);
    }
  };

  const toggleAutoMode = () => {
    setScheduler(prev => ({
      ...prev,
      mode: prev.mode === 'auto' ? 'manual' : 'auto',
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">任务调度器</h1>
            <p className="text-gray-400">
              智能分配 · 优先级管理 · 容量规划
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAutoMode}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              scheduler.mode === 'auto'
                ? 'bg-green-600 text-white'
                : 'bg-slate-700 text-gray-300'
            }`}
          >
            {scheduler.mode === 'auto' ? <Zap className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
            {scheduler.mode === 'auto' ? '自动模式' : '手动模式'}
          </button>
          <button
            onClick={loadData}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Capacity Bar */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-400" />
            容量状态
          </h2>
          <div className="text-sm">
            <span className={scheduler.capacity.available > 0 ? 'text-green-400' : 'text-red-400'}>
              {scheduler.capacity.available > 0 ? `可调度 ${scheduler.capacity.available} 个` : '已满载'}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {[...Array(scheduler.capacity.max)].map((_, i) => {
            const isUsed = i < scheduler.capacity.used;
            const isActive = i < scheduler.executing.filter(t => t.status === 'running').length;
            return (
              <div
                key={i}
                className={`flex-1 h-12 rounded-lg flex items-center justify-center font-medium ${
                  isActive
                    ? 'bg-green-500 text-white'
                    : isUsed
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-700 text-gray-400'
                }`}
              >
                {isActive ? '运行中' : isUsed ? '占用' : '空闲'}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue - Waiting Tasks */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            待调度队列
            <span className="ml-auto text-sm text-gray-400">{scheduler.queue.length}</span>
          </h2>

          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {scheduler.queue.length > 0 ? (
              scheduler.queue.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onPriorityChange={(p) => setPriority(task.id, p)}
                  onSchedule={() => moveToScheduled(task.id)}
                  canSchedule={scheduler.capacity.available > 0}
                />
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>队列为空</p>
              </div>
            )}
          </div>
        </div>

        {/* Scheduled - Ready to Run */}
        <div className="bg-slate-800 rounded-xl border border-cyan-500/30 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-cyan-400" />
            已调度
            <span className="ml-auto text-sm text-gray-400">{scheduler.scheduled.length}</span>
          </h2>

          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {scheduler.scheduled.length > 0 ? (
              scheduler.scheduled.map((task) => (
                <div key={task.id} className="p-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-white">{task.title}</div>
                      <div className="text-sm text-gray-400">{task.repo}</div>
                    </div>
                    <button
                      onClick={() => triggerTask(task)}
                      className="p-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
                      title="立即执行"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <PriorityBadge priority={task.priority} />
                    <span className="text-xs text-gray-500">{task.estimated_time}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>没有待执行的任务</p>
                <p className="text-sm mt-1">从队列中选择任务</p>
              </div>
            )}
          </div>
        </div>

        {/* Executing - Currently Running */}
        <div className="bg-slate-800 rounded-xl border border-green-500/30 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Play className="w-5 h-5 text-green-400" />
            执行中
            <span className="ml-auto text-sm text-gray-400">{scheduler.executing.length}</span>
          </h2>

          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {scheduler.executing.length > 0 ? (
              scheduler.executing.map((task) => (
                <div
                  key={task.id}
                  className={`p-4 rounded-lg border ${
                    task.status === 'running'
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-slate-700 bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {task.status === 'running' ? (
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    ) : (
                      <div className="w-3 h-3 bg-amber-500 rounded-full" />
                    )}
                    <span className="font-medium text-white">{task.repo}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{task.title}</div>
                  <div className="text-xs text-gray-500 mt-2">运行时间: {task.estimated_time}</div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Pause className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>没有执行中的任务</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auto Mode Info */}
      {scheduler.mode === 'auto' && (
        <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-green-400" />
            <div>
              <h3 className="font-semibold text-green-400">自动调度已启用</h3>
              <p className="text-sm text-green-300/70">
                系统将自动按优先级调度任务，当有空闲容量时自动执行队列中的 P0 任务
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Help */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">使用说明</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-2">
            <h3 className="font-medium text-cyan-400">1. 设置优先级</h3>
            <p className="text-gray-400">
              P0 = 紧急必须<br />
              P1 = 重要<br />
              P2 = 可延后
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-cyan-400">2. 调度任务</h3>
            <p className="text-gray-400">
              从队列选择任务，点击「调度」按钮移到待执行
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-cyan-400">3. 执行任务</h3>
            <p className="text-gray-400">
              在「已调度」中点击播放按钮，触发 Cecelia 执行
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onPriorityChange,
  onSchedule,
  canSchedule,
}: {
  task: Task;
  onPriorityChange: (p: 'P0' | 'P1' | 'P2') => void;
  onSchedule: () => void;
  canSchedule: boolean;
}) {
  return (
    <div className="p-4 rounded-lg border border-slate-700 bg-slate-900/50">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate">{task.title}</div>
          <div className="text-sm text-gray-400">{task.repo}</div>
          <div className="text-xs text-gray-500 font-mono mt-1">{task.prd_file}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        {/* Priority Selector */}
        <div className="flex gap-1">
          {(['P0', 'P1', 'P2'] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPriorityChange(p)}
              className={`px-2 py-1 text-xs rounded ${
                task.priority === p
                  ? p === 'P0'
                    ? 'bg-red-500 text-white'
                    : p === 'P1'
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-500 text-white'
                  : 'bg-slate-700 text-gray-400 hover:bg-slate-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Schedule Button */}
        <button
          onClick={onSchedule}
          disabled={!canSchedule}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            canSchedule
              ? 'bg-cyan-600 hover:bg-cyan-700 text-white'
              : 'bg-slate-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          <Send className="w-3 h-3" />
          调度
        </button>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: 'P0' | 'P1' | 'P2' }) {
  const colors = {
    P0: 'bg-red-500/20 text-red-400 border-red-500/30',
    P1: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    P2: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${colors[priority]}`}>
      {priority}
    </span>
  );
}
