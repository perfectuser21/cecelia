/**
 * Cecelia Overview - 管家系统总览
 * 整合 Seats 状态、任务队列、系统健康
 */

import { useState, useEffect } from 'react';
import {
  Bot,
  User,
  Play,
  Pause,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  ListTodo,
  Activity,
  AlertCircle,
  Brain
} from 'lucide-react';

interface TickStatus {
  enabled: boolean;
  loop_running: boolean;
  max_concurrent: number;
  reserved_slots: number;
  auto_dispatch_max: number;
  dispatch_cooldown_ms: number;
  last_dispatch?: {
    task_id: string;
    task_title: string;
    dispatched_at: string;
    success: boolean;
  };
}

interface VPSSlot {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  taskId: string | null;  // null = headed (human), string = headless (auto)
  command: string;
}

interface VPSSlots {
  total: number;
  used: number;
  available: number;
  slots: VPSSlot[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
}

interface BrainStatus {
  pack_version: string;
  task_digest: {
    stats: {
      open_p0: number;
      open_p1: number;
      in_progress: number;
      queued: number;
    };
    p0: Task[];
    p1: Task[];
  };
  system_health: {
    task_system_ok: boolean;
    n8n_ok: boolean;
  };
}

export default function CeceliaOverview() {
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [vpsSlots, setVpsSlots] = useState<VPSSlots | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [tickRes, brainRes, slotsRes] = await Promise.all([
        fetch('/api/brain/tick/status'),
        fetch('/api/brain/status'),
        fetch('/api/brain/vps-slots')
      ]);

      if (tickRes.ok) setTickStatus(await tickRes.json());
      if (brainRes.ok) setBrainStatus(await brainRes.json());
      if (slotsRes.ok) setVpsSlots(await slotsRes.json());
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleTick = async () => {
    if (!tickStatus) return;
    setActionLoading(true);
    try {
      const endpoint = tickStatus.enabled ? '/api/brain/tick/disable' : '/api/brain/tick/enable';
      await fetch(endpoint, { method: 'POST' });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !tickStatus) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const maxSeats = tickStatus?.max_concurrent || 6;
  const autoMax = tickStatus?.auto_dispatch_max || 5;
  const reservedSlots = tickStatus?.reserved_slots || 1;
  const queued = brainStatus?.task_digest?.stats?.queued || 0;
  const inProgress = brainStatus?.task_digest?.stats?.in_progress || 0;

  // 区分有头和无头进程 (用 command 检测: "claude -p" = 无头)
  const headlessProcesses = vpsSlots?.slots.filter(s => s.command?.includes('-p')) || [];
  const headedProcesses = vpsSlots?.slots.filter(s => s.command && !s.command.includes('-p')) || [];
  const headedCount = headedProcesses.length;
  const headlessCount = headlessProcesses.length;

  // Seats 可视化
  // 布局: [无头1] [无头2] ... [有头1] [有头2] ... [空闲] ... [预留]
  type SeatStatus = 'headless' | 'headed' | 'reserved-empty' | 'empty';
  const seats: SeatStatus[] = Array.from({ length: maxSeats }, (_, i) => {
    // 先显示无头进程
    if (i < headlessCount) return 'headless';
    // 然后显示有头进程
    if (i < headlessCount + headedCount) return 'headed';
    // 最后一个席位是预留（如果没被用掉）
    if (i === maxSeats - 1 && headedCount === 0) return 'reserved-empty';
    // 其余是空闲
    return 'empty';
  });

  const allTasks = [
    ...(brainStatus?.task_digest?.p0 || []),
    ...(brainStatus?.task_digest?.p1 || [])
  ].slice(0, 8);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Cecelia</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">管家系统 • v{brainStatus?.pack_version || '2.0'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition"
          >
            <RefreshCw className={`w-4 h-4 text-slate-600 dark:text-slate-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={toggleTick}
            disabled={actionLoading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition shadow-sm ${
              tickStatus?.enabled
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
            }`}
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : tickStatus?.enabled ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {tickStatus?.enabled ? '暂停' : '启动'}
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Seats - 占 2 列 */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-700 dark:text-slate-200">Seats</h2>
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              无头 {headlessCount}/{autoMax} • 有头 {headedCount}/{reservedSlots}
            </span>
          </div>

          {/* Seats 可视化 */}
          <div className="flex gap-3 flex-wrap mb-4">
            {seats.map((status, i) => (
              <div
                key={i}
                className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center transition-all ${
                  status === 'headless'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25'
                    : status === 'headed'
                      ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                      : status === 'reserved-empty'
                        ? 'bg-amber-50 text-amber-500 border-2 border-dashed border-amber-300 dark:bg-amber-900/20 dark:border-amber-600'
                        : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
                }`}
              >
                {status === 'headless' ? (
                  <>
                    <Bot className="w-4 h-4" />
                    <span className="text-[10px] mt-0.5">无头</span>
                  </>
                ) : status === 'headed' ? (
                  <>
                    <User className="w-4 h-4" />
                    <span className="text-[10px] mt-0.5">有头</span>
                  </>
                ) : status === 'reserved-empty' ? (
                  <>
                    <User className="w-4 h-4" />
                    <span className="text-[10px] mt-0.5">预留</span>
                  </>
                ) : (
                  <span className="text-sm font-medium">{i + 1}</span>
                )}
              </div>
            ))}
          </div>

          {/* 图例 */}
          <div className="flex gap-4 flex-wrap text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-blue-500" />
              <span>无头 ({headlessCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-emerald-500" />
              <span>有头 ({headedCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-slate-200 dark:bg-slate-600" />
              <span>空闲</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded border border-dashed border-amber-400 bg-amber-50" />
              <span>预留 ({reservedSlots})</span>
            </div>
          </div>

          {/* 进程详情 */}
          {vpsSlots && vpsSlots.slots.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              <div className="space-y-2">
                {vpsSlots.slots.map((slot, i) => {
                  const isHeaded = !slot.command?.includes('-p');
                  return (
                    <div key={i} className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
                      isHeaded
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isHeaded
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300'
                        }`}>
                          {isHeaded ? '有头' : '无头'}
                        </span>
                        <span className="font-mono text-slate-500 text-xs">PID {slot.pid}</span>
                        <span className="text-slate-400">CPU {slot.cpu}</span>
                        <span className="text-slate-400">MEM {slot.memory}</span>
                      </div>
                      <span className="text-slate-400 text-xs">{slot.startTime}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Stats - 占 1 列 */}
        <div className="space-y-4">
          {/* 任务统计 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-4">
              <ListTodo className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">任务</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-2xl font-bold text-slate-800 dark:text-white">{queued}</div>
                <div className="text-xs text-slate-500">队列等待</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{inProgress}</div>
                <div className="text-xs text-slate-500">执行中</div>
              </div>
            </div>
          </div>

          {/* 系统状态 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">系统</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Tick Loop</span>
                {tickStatus?.loop_running ? (
                  <span className="flex items-center gap-1 text-emerald-600 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> 运行
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500 text-sm">
                    <XCircle className="w-4 h-4" /> 停止
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Brain</span>
                <span className="flex items-center gap-1 text-emerald-600 text-sm">
                  <CheckCircle2 className="w-4 h-4" /> 正常
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Tick 间隔</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {(tickStatus?.dispatch_cooldown_ms || 5000) / 1000}s
                </span>
              </div>
            </div>
          </div>

          {/* 最近派发 */}
          {tickStatus?.last_dispatch && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">最近派发</span>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-200 mb-1 line-clamp-1">
                {tickStatus.last_dispatch.task_title}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {new Date(tickStatus.last_dispatch.dispatched_at).toLocaleTimeString('zh-CN')}
                </span>
                {tickStatus.last_dispatch.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 任务队列 */}
      {allTasks.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-4">任务队列</h3>
          <div className="space-y-2">
            {allTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                    task.priority === 'P0'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  }`}>
                    {task.priority}
                  </span>
                  <span className="text-sm text-slate-700 dark:text-slate-200">{task.title}</span>
                </div>
                <span className={`text-xs font-medium ${
                  task.status === 'queued'
                    ? 'text-slate-500'
                    : task.status === 'in_progress'
                      ? 'text-blue-600'
                      : 'text-emerald-600'
                }`}>
                  {task.status === 'queued' ? '排队' : task.status === 'in_progress' ? '执行中' : task.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
