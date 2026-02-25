import { useState, useEffect, useCallback } from 'react';
import { Zap, RefreshCw, Lock, Clock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface AreaInfo {
  id: string;
  title: string;
  priority: string;
  status: string;
  progress: number;
}

interface InitiativeInfo {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface KRInfo {
  id: string;
  title: string;
}

interface ActiveInitiative {
  initiative: InitiativeInfo;
  kr: KRInfo;
  lockReason: 'in_progress' | 'fifo';
  inProgressTasks: number;
  queuedTasks: number;
}

interface Stream {
  area: AreaInfo;
  activeInitiative: ActiveInitiative | null;
  totalQueuedTasks: number;
}

interface WorkStreamsData {
  activeAreaCount: number;
  streams: Stream[];
  timestamp: string;
}

function PriorityBadge({ priority }: { priority: string }) {
  const colorMap: Record<string, string> = {
    P0: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800',
    P1: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800',
    P2: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-600',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorMap[priority] ?? colorMap['P2']}`}>
      {priority}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: 'bg-green-500',
    in_progress: 'bg-blue-500',
    pending: 'bg-slate-400',
    completed: 'bg-emerald-500',
    paused: 'bg-yellow-500',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colorMap[status] ?? 'bg-slate-400'}`} />
  );
}

function LockReasonBadge({ reason }: { reason: 'in_progress' | 'fifo' }) {
  if (reason === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
        <Lock className="w-3 h-3" />
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
      <Clock className="w-3 h-3" />
      FIFO
    </span>
  );
}

function StreamCard({ stream }: { stream: Stream }) {
  const { area, activeInitiative, totalQueuedTasks } = stream;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
      {/* Area Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <Zap className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-tight">
              {area.title}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusDot status={area.status} />
              <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">{area.status}</span>
            </div>
          </div>
        </div>
        <PriorityBadge priority={area.priority} />
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
          <span>进度</span>
          <span>{area.progress}%</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, area.progress))}%` }}
          />
        </div>
      </div>

      {/* Active Initiative */}
      {activeInitiative ? (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 mb-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                {activeInitiative.initiative.name}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
                {activeInitiative.kr.title}
              </p>
            </div>
            <LockReasonBadge reason={activeInitiative.lockReason} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
              {activeInitiative.inProgressTasks} 进行中
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              {activeInitiative.queuedTasks} 队列中
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 mb-3 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">暂无锁定 Initiative</p>
        </div>
      )}

      {/* Queue Summary */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400">待处理任务</span>
        <span className={`font-semibold ${totalQueuedTasks > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
          {totalQueuedTasks}
        </span>
      </div>
    </div>
  );
}

export default function WorkStreams() {
  const [data, setData] = useState<WorkStreamsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStreams = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/work/streams');
      if (!res.ok) {
        if (res.status === 404) {
          setError('Streams API 尚未部署（Brain 端点 /api/brain/work/streams 不存在）');
        } else {
          setError(`请求失败：${res.status} ${res.statusText}`);
        }
        return;
      }
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      setError('无法连接到 Brain 服务，请确认 Brain 已运行');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(() => fetchStreams(true), 10000);
    return () => clearInterval(interval);
  }, [fetchStreams]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-500" />
            Active Streams
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Area Stream 调度状态 · 每 10 秒自动刷新
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              最后更新：{formatTime(lastRefresh)}
            </span>
          )}
          <button
            onClick={() => fetchStreams(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
          <span className="ml-2 text-slate-500 dark:text-slate-400">加载中...</span>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-full mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">加载失败</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">{error}</p>
          <button
            onClick={() => fetchStreams()}
            className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Summary Bar */}
      {!loading && !error && data && (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 dark:border-purple-900/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-purple-700 dark:text-purple-300">{data.activeAreaCount}</span> 个活跃 Area
              </span>
            </div>
            <div className="h-4 w-px bg-purple-200 dark:bg-purple-800" />
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-blue-700 dark:text-blue-300">
                  {data.streams.filter(s => s.activeInitiative !== null).length}
                </span> 个锁定 Initiative
              </span>
            </div>
            <div className="h-4 w-px bg-purple-200 dark:bg-purple-800" />
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {data.streams.reduce((sum, s) => sum + s.totalQueuedTasks, 0)}
                </span> 个待处理任务
              </span>
            </div>
          </div>

          {/* Streams Grid */}
          {data.streams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="p-3 bg-slate-100 dark:bg-slate-700 rounded-full mb-3">
                <Zap className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-medium">暂无活跃 Stream</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">当 Area 有待处理任务时会出现在这里</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.streams.map(stream => (
                <StreamCard key={stream.area.id} stream={stream} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
