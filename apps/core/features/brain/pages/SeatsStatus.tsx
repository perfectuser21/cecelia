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
  Bot
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

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
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
  system_health: {
    task_system_ok: boolean;
  };
}

export default function SeatsStatus() {
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [claudeCount, setClaudeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch tick status
      const tickRes = await fetch('/api/brain/tick/status');
      if (tickRes.ok) {
        setTickStatus(await tickRes.json());
      }

      // Fetch brain status
      const brainRes = await fetch('/api/brain/status');
      if (brainRes.ok) {
        const data = await brainRes.json();
        setBrainStatus(data);
      }

      // Fetch actual Claude process count from VPS
      const slotsRes = await fetch('/api/brain/vps-slots');
      if (slotsRes.ok) {
        const slotsData = await slotsRes.json();
        setClaudeCount(slotsData.used || 0);
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

  const maxSeats = tickStatus?.max_concurrent || 6;
  const reservedSlots = tickStatus?.reserved_slots || 1;
  const autoMax = tickStatus?.auto_dispatch_max || 5;
  const queued = brainStatus?.task_digest?.stats?.queued || 0;

  // Build seats visualization using actual Claude process count
  const seats = Array.from({ length: maxSeats }, (_, i) => {
    if (i < claudeCount) return 'occupied';
    if (i >= autoMax) return 'reserved';
    return 'empty';
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="w-6 h-6 text-blue-500" />
          <h1 className="text-xl font-semibold">Seats 状态</h1>
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

      {/* Seats Visualization */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          席位状态 ({claudeCount}/{autoMax} 自动派发，{reservedSlots} 预留人工)
        </h2>

        <div className="flex gap-3 flex-wrap">
          {seats.map((status, i) => (
            <div
              key={i}
              className={`w-16 h-16 rounded-xl flex items-center justify-center transition-all
                ${status === 'occupied'
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                  : status === 'reserved'
                    ? 'bg-amber-100 text-amber-600 border-2 border-dashed border-amber-300 dark:bg-amber-900/30 dark:border-amber-600'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                }`}
            >
              {status === 'occupied' ? (
                <Bot className="w-6 h-6" />
              ) : status === 'reserved' ? (
                <User className="w-6 h-6" />
              ) : (
                <span className="text-lg font-medium">{i + 1}</span>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-6 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-gray-600 dark:text-gray-400">运行中 ({claudeCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-600" />
            <span className="text-gray-600 dark:text-gray-400">空闲</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-2 border-dashed border-amber-400 bg-amber-100" />
            <span className="text-gray-600 dark:text-gray-400">预留人工 ({reservedSlots})</span>
          </div>
        </div>
      </div>

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
            <span className="text-sm">Claude 进程</span>
          </div>
          <div className="text-2xl font-semibold">{claudeCount}</div>
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
