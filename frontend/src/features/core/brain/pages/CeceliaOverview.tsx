/**
 * Cecelia Overview - 管家系统总览
 * 占满屏幕的布局，完整显示所有席位
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ListTodo,
  Brain,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff
} from 'lucide-react';

interface TickStatus {
  enabled: boolean;
  loop_running: boolean;
  dispatch_cooldown_ms: number;
  last_dispatch?: {
    task_id: string;
    task_title: string;
    dispatched_at: string;
    success: boolean;
  };
}

interface ServerProcess {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  command: string;
}

interface ServerStatus {
  id: string;
  name: string;
  location: string;
  ip: string;
  status: 'online' | 'offline';
  resources: {
    cpu_cores: number;
    cpu_load: number;
    cpu_pct: number;
    mem_total_gb: number;
    mem_free_gb: number;
    mem_used_pct: number;
  } | null;
  slots: {
    max: number;
    dynamic_max: number;
    used: number;
    available: number;
    reserved: number;
    processes: ServerProcess[];
  };
  task_types: string[];
}

interface ClusterStatus {
  total_slots: number;
  total_used: number;
  total_available: number;
  servers: ServerStatus[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
}

interface BrainStatus {
  task_digest: {
    stats: {
      in_progress: number;
      queued: number;
    };
    p0: Task[];
    p1: Task[];
  };
}

// 服务器卡片 - 占满风格
function ServerCard({ server, onClick }: { server: ServerStatus; onClick: () => void }) {
  const isOnline = server.status === 'online';
  const cpuDanger = server.resources && server.resources.cpu_pct > 80;
  const memDanger = server.resources && server.resources.mem_used_pct > 80;

  // 区分有头和无头
  const headlessProcesses = server.slots.processes.filter(p => p.command?.includes('-p'));
  const headedProcesses = server.slots.processes.filter(p => p.command && !p.command.includes('-p'));
  const headlessCount = headlessProcesses.length;
  const headedCount = headedProcesses.length;

  const dynamicMax = server.slots.dynamic_max || 0;
  const theoreticalMax = server.slots.max; // 12 或 5

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border cursor-pointer transition-all hover:shadow-lg hover:border-blue-400 ${
        isOnline ? 'border-slate-200 dark:border-slate-700' : 'border-red-300 dark:border-red-800'
      }`}
    >
      {/* Server Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Server className={`w-5 h-5 ${isOnline ? 'text-emerald-500' : 'text-red-500'}`} />
          <div>
            <h3 className="font-semibold">{server.location} {server.name}</h3>
            <span className="text-xs text-slate-500 font-mono">{server.ip}</span>
          </div>
        </div>
        {isOnline ? (
          <Wifi className="w-4 h-4 text-green-500" />
        ) : (
          <WifiOff className="w-4 h-4 text-red-500" />
        )}
      </div>

      {/* Resource Meters */}
      {server.resources ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Cpu className="w-3 h-3" />
              <span>CPU</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-bold ${cpuDanger ? 'text-red-500' : ''}`}>
                {server.resources.cpu_pct}%
              </span>
              <span className="text-xs text-slate-400">
                {server.resources.cpu_load}/{server.resources.cpu_cores}核
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${cpuDanger ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, server.resources.cpu_pct)}%` }}
              />
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <HardDrive className="w-3 h-3" />
              <span>内存</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-bold ${memDanger ? 'text-red-500' : ''}`}>
                {server.resources.mem_used_pct}%
              </span>
              <span className="text-xs text-slate-400">
                {server.resources.mem_free_gb}GB 可用
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${memDanger ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${server.resources.mem_used_pct}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 mb-4 text-center text-slate-500">
          无法获取资源数据
        </div>
      )}

      {/* Seats Visualization - 完整显示所有席位 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>席位 ({server.slots.used}/{theoreticalMax})</span>
          <span className="text-xs">
            可用 {dynamicMax - server.slots.used - server.slots.reserved} / 资源限制 {theoreticalMax - dynamicMax}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: theoreticalMax }, (_, i) => {
            const seatNum = i + 1;
            // 判断这个席位的状态
            const isHeadless = i < headlessCount;
            const isHeaded = i >= headlessCount && i < headlessCount + headedCount;
            const isOccupied = isHeadless || isHeaded;
            const isReserved = !isOccupied && i >= theoreticalMax - server.slots.reserved;
            const isResourceLimited = !isOccupied && !isReserved && seatNum > dynamicMax;
            const isAvailable = !isOccupied && !isReserved && !isResourceLimited;

            return (
              <div
                key={i}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all text-sm
                  ${isHeadless
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30'
                    : isHeaded
                      ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                      : isReserved
                        ? 'bg-amber-50 text-amber-500 border-2 border-dashed border-amber-300 dark:bg-amber-900/20'
                        : isResourceLimited
                          ? 'bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 text-slate-300 dark:text-slate-600'
                          : 'bg-slate-100 text-slate-400 dark:bg-slate-700'
                  }`}
                title={
                  isHeadless ? '无头任务 (auto)' :
                  isHeaded ? '有头会话 (manual)' :
                  isReserved ? '预留给手动会话' :
                  isResourceLimited ? '资源不足，暂不可用' :
                  '可用'
                }
              >
                {isHeadless ? (
                  <Bot className="w-4 h-4" />
                ) : isHeaded ? (
                  <User className="w-4 h-4" />
                ) : isReserved ? (
                  <User className="w-4 h-4" />
                ) : isResourceLimited ? (
                  <span className="text-xs">×</span>
                ) : (
                  seatNum
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Running Processes */}
      {server.slots.processes.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
          <div className="text-xs text-slate-500 mb-2">运行中的进程</div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {server.slots.processes.map((proc, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-700/50 rounded px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-slate-400 shrink-0">PID {proc.pid}</span>
                  <span className="truncate text-slate-600 dark:text-slate-300" title={proc.command}>
                    {proc.command.length > 40 ? proc.command.slice(0, 40) + '...' : proc.command}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-slate-500">
                  <span>CPU {proc.cpu}</span>
                  <span>MEM {proc.memory}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task Types */}
      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="flex gap-1.5 flex-wrap">
          {server.task_types.map(type => (
            <span key={type} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-300">
              {type}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CeceliaOverview() {
  const navigate = useNavigate();
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [tickRes, brainRes, clusterRes] = await Promise.all([
        fetch('/api/brain/tick/status'),
        fetch('/api/brain/status'),
        fetch('/api/brain/cluster/status')
      ]);

      if (tickRes.ok) setTickStatus(await tickRes.json());
      if (brainRes.ok) setBrainStatus(await brainRes.json());
      if (clusterRes.ok) {
        const data = await clusterRes.json();
        if (data.success) setCluster(data.cluster);
      }
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
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const queued = brainStatus?.task_digest?.stats?.queued || 0;
  const inProgress = brainStatus?.task_digest?.stats?.in_progress || 0;
  const allTasks = [...(brainStatus?.task_digest?.p0 || []), ...(brainStatus?.task_digest?.p1 || [])];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-blue-500" />
          <div>
            <h1 className="text-xl font-semibold">Cecelia 总览</h1>
            {cluster && (
              <span className="text-sm text-slate-500">
                {cluster.total_used}/{cluster.total_slots} 席位使用中
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={toggleTick}
            disabled={actionLoading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition
              ${tickStatus?.enabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
              }`}
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : tickStatus?.enabled ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {tickStatus?.enabled ? '暂停派发' : '启动派发'}
          </button>
        </div>
      </div>

      {/* Dual Server View */}
      {cluster && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cluster.servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              onClick={() => navigate(`/brain/server/${server.id}`)}
            />
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm">队列等待</span>
          </div>
          <div className="text-2xl font-semibold">{queued}</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
            <Loader2 className="w-4 h-4" />
            <span className="text-sm">运行中</span>
          </div>
          <div className="text-2xl font-semibold">{inProgress}</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm">Tick 间隔</span>
          </div>
          <div className="text-2xl font-semibold">{(tickStatus?.dispatch_cooldown_ms || 5000) / 1000}s</div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
            {tickStatus?.loop_running ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm">Tick Loop</span>
          </div>
          <div className={`text-2xl font-semibold ${tickStatus?.loop_running ? 'text-emerald-600' : 'text-red-600'}`}>
            {tickStatus?.loop_running ? '运行中' : '已停止'}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-sm text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Bot className="w-3 h-3 text-white" />
          </div>
          <span>无头 (auto)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <User className="w-3 h-3 text-white" />
          </div>
          <span>有头 (manual)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs text-slate-400">1</div>
          <span>可用</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded border-2 border-dashed border-amber-400 bg-amber-50 flex items-center justify-center">
            <User className="w-3 h-3 text-amber-500" />
          </div>
          <span>预留</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-300">×</div>
          <span>资源不足</span>
        </div>
      </div>

      {/* Last Dispatch */}
      {tickStatus?.last_dispatch && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">最近派发</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{tickStatus.last_dispatch.task_title}</div>
              <div className="text-sm text-slate-500">
                {new Date(tickStatus.last_dispatch.dispatched_at).toLocaleString('zh-CN')}
              </div>
            </div>
            {tickStatus.last_dispatch.success ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
          </div>
        </div>
      )}

      {/* Queued Tasks */}
      {allTasks.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <ListTodo className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">待处理任务</h3>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {allTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded
                    ${task.priority === 'P0' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}
                  >
                    {task.priority}
                  </span>
                  <span className="text-sm">{task.title}</span>
                </div>
                <span className={`text-sm
                  ${task.status === 'queued' ? 'text-slate-500' :
                    task.status === 'in_progress' ? 'text-blue-500' :
                    task.status === 'failed' ? 'text-red-500' : 'text-emerald-500'}`}
                >
                  {task.status === 'queued' ? '排队中' :
                   task.status === 'in_progress' ? '执行中' :
                   task.status === 'failed' ? '失败' : task.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
