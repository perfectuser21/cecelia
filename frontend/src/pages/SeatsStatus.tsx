import { useState, useEffect } from 'react';
import {
  Monitor,
  RefreshCw,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  Bot,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff
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
  trigger_source?: string;
}

interface BrainStatus {
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
}

function ServerCard({ server, tickEnabled }: { server: ServerStatus; tickEnabled: boolean }) {
  const isOnline = server.status === 'online';
  const cpuDanger = server.resources && server.resources.cpu_pct > 80;
  const memDanger = server.resources && server.resources.mem_used_pct > 80;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border ${
      isOnline ? 'border-gray-200 dark:border-gray-700' : 'border-red-300 dark:border-red-800'
    }`}>
      {/* Server Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Server className={`w-5 h-5 ${isOnline ? 'text-green-500' : 'text-red-500'}`} />
          <div>
            <h3 className="font-semibold">{server.location} {server.name}</h3>
            <span className="text-xs text-gray-500 font-mono">{server.ip}</span>
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
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Cpu className="w-3 h-3" />
              <span>CPU</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-bold ${cpuDanger ? 'text-red-500' : ''}`}>
                {server.resources.cpu_pct}%
              </span>
              <span className="text-xs text-gray-400">
                {server.resources.cpu_load}/{server.resources.cpu_cores}核
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${cpuDanger ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, server.resources.cpu_pct)}%` }}
              />
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <HardDrive className="w-3 h-3" />
              <span>内存</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-bold ${memDanger ? 'text-red-500' : ''}`}>
                {server.resources.mem_used_pct}%
              </span>
              <span className="text-xs text-gray-400">
                {server.resources.mem_free_gb}GB 可用
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${memDanger ? 'bg-red-500' : 'bg-green-500'}`}
                style={{ width: `${server.resources.mem_used_pct}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4 text-center text-gray-500">
          无法获取资源数据
        </div>
      )}

      {/* Seats Visualization */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
          <span>席位 ({server.slots.used}/{server.slots.max})</span>
          <span className="text-xs">{server.task_types.join(', ')}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: server.slots.max }, (_, i) => {
            const isOccupied = i < server.slots.used;
            const isReserved = i >= server.slots.max - server.slots.reserved;
            return (
              <div
                key={i}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all text-sm
                  ${isOccupied
                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                    : isReserved
                      ? 'bg-amber-100 text-amber-600 border-2 border-dashed border-amber-300 dark:bg-amber-900/30'
                      : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                  }`}
              >
                {isOccupied ? (
                  <Bot className="w-4 h-4" />
                ) : isReserved ? (
                  <User className="w-4 h-4" />
                ) : (
                  i + 1
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Running Processes */}
      {server.slots.processes.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
          <div className="text-xs text-gray-500 mb-2">运行中的进程</div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {server.slots.processes.map((proc, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-700/50 rounded px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-gray-400 shrink-0">PID {proc.pid}</span>
                  <span className="truncate text-gray-600 dark:text-gray-300" title={proc.command}>
                    {proc.command.slice(0, 40)}...
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-gray-500">
                  <span>CPU {proc.cpu}</span>
                  <span>MEM {proc.memory}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SeatsStatus() {
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);

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

      setError('');
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
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
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const queued = brainStatus?.task_digest?.stats?.queued || 0;
  const inProgress = brainStatus?.task_digest?.stats?.in_progress || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="w-6 h-6 text-blue-500" />
          <div>
            <h1 className="text-xl font-semibold">Cluster Seats</h1>
            {cluster && (
              <span className="text-sm text-gray-500">
                {cluster.total_used}/{cluster.total_slots} 席位使用中
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={toggleTick}
            disabled={actionLoading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition
              ${tickStatus?.enabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
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

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Dual Server View */}
      {cluster && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cluster.servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              tickEnabled={tickStatus?.enabled || false}
            />
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm">队列等待</span>
          </div>
          <div className="text-2xl font-semibold">{queued}</div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Loader2 className="w-4 h-4" />
            <span className="text-sm">运行中</span>
          </div>
          <div className="text-2xl font-semibold">{inProgress}</div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm">Tick 间隔</span>
          </div>
          <div className="text-2xl font-semibold">{(tickStatus?.dispatch_cooldown_ms || 5000) / 1000}s</div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            {tickStatus?.loop_running ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm">Tick Loop</span>
          </div>
          <div className={`text-2xl font-semibold ${tickStatus?.loop_running ? 'text-green-600' : 'text-red-600'}`}>
            {tickStatus?.loop_running ? '运行中' : '已停止'}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-blue-500" />
          <span>自动任务 (auto)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-200 dark:bg-gray-600" />
          <span>空闲</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-dashed border-amber-400 bg-amber-100" />
          <span>预留手动 (manual)</span>
        </div>
      </div>

      {/* Last Dispatch */}
      {tickStatus?.last_dispatch && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">最近派发</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{tickStatus.last_dispatch.task_title}</div>
              <div className="text-sm text-gray-500">
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
      {(brainStatus?.task_digest?.p0?.length || brainStatus?.task_digest?.p1?.length) ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">待处理任务</h3>
          <div className="space-y-2">
            {[...(brainStatus?.task_digest?.p0 || []), ...(brainStatus?.task_digest?.p1 || [])].map(task => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded
                    ${task.priority === 'P0' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}
                  >
                    {task.priority}
                  </span>
                  <span>{task.title}</span>
                </div>
                <span className={`text-sm
                  ${task.status === 'queued' ? 'text-gray-500' :
                    task.status === 'in_progress' ? 'text-blue-500' : 'text-green-500'}`}
                >
                  {task.status === 'queued' ? '排队中' :
                   task.status === 'in_progress' ? '执行中' : task.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
