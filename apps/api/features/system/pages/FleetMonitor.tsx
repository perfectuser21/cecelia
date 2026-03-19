import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  MapPin,
  Loader2,
} from 'lucide-react';

interface ServerStats {
  id: string;
  name: string;
  location: string;
  tailscapeIp: string;
  publicIp: string | null;
  role: string;
  status: 'online' | 'offline';
  error?: string;
  cpu: {
    cores: number;
    model: string;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    usagePercent: number;
  } | null;
  memory: {
    totalGB: number;
    usedGB: number;
    usagePercent: number;
  } | null;
  disk: {
    total: string;
    used: string;
    usagePercent: number;
  } | null;
  uptime: number | null;
  platform: string | null;
  hostname: string | null;
}

interface FleetResponse {
  servers: ServerStats[];
  summary: { total: number; online: number; offline: number };
  timestamp: number;
}

function formatUptime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return 'text-red-400';
  if (percent >= 70) return 'text-yellow-400';
  return 'text-emerald-400';
}

function getUsageBarColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function UsageBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={getUsageColor(percent)}>{percent}%</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getUsageBarColor(percent)}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: ServerStats }) {
  const isOnline = server.status === 'online';

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        isOnline
          ? 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
          : 'bg-slate-900/50 border-red-900/30 opacity-75'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className={`w-4 h-4 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`} />
          <div>
            <h3 className="text-sm font-medium text-white">{server.name}</h3>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="w-3 h-3" />
              {server.location}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isOnline ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400" />
          )}
          <span className={`text-xs font-medium ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Role */}
      <div className="mb-3">
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300">
          {server.role}
        </span>
      </div>

      {isOnline && server.cpu && server.memory && server.disk ? (
        <>
          {/* CPU */}
          <div className="space-y-2.5 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Cpu className="w-3 h-3" />
              <span>{server.cpu.cores} cores</span>
              <span className="text-slate-600">|</span>
              <span>load {server.cpu.loadAvg1}/{server.cpu.loadAvg5}/{server.cpu.loadAvg15}</span>
            </div>
            <UsageBar percent={server.cpu.usagePercent} label="CPU" />
          </div>

          {/* Memory */}
          <div className="space-y-2.5 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <MemoryStick className="w-3 h-3" />
              <span>{server.memory.usedGB}GB / {server.memory.totalGB}GB</span>
            </div>
            <UsageBar percent={server.memory.usagePercent} label="Memory" />
          </div>

          {/* Disk */}
          <div className="space-y-2.5 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <HardDrive className="w-3 h-3" />
              <span>{server.disk.used} / {server.disk.total}</span>
            </div>
            <UsageBar percent={server.disk.usagePercent} label="Disk" />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-700/50">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>up {formatUptime(server.uptime)}</span>
            </div>
            <span className="text-slate-600">{server.tailscapeIp}</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500 py-4 text-center">
          {server.error || 'Connection failed'}
        </div>
      )}
    </div>
  );
}

export default function FleetMonitor() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch('/api/brain/infra-status/servers');
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    } catch (err) {
      console.error('Failed to fetch fleet status:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading fleet status...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Fleet Status
          </h2>
          {data?.summary && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-emerald-400">{data.summary.online} online</span>
              {data.summary.offline > 0 && (
                <span className="text-red-400">{data.summary.offline} offline</span>
              )}
              <span className="text-slate-500">/ {data.summary.total} total</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {lastUpdate && `更新于 ${lastUpdate}`}
          </span>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Server Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data?.servers.map((server) => (
          <ServerCard key={server.id} server={server} />
        ))}
      </div>
    </div>
  );
}
