/**
 * Server Detail - 服务器详情页
 * 显示单个服务器的完整信息
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Server,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Bot,
  User,
  GitBranch,
  Clock,
  Activity
} from 'lucide-react';

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

export default function ServerDetail() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/brain/cluster/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const found = data.cluster.servers.find((s: ServerStatus) => s.id === serverId);
          setServer(found || null);
        }
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
  }, [serverId]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="p-6">
        <button onClick={() => navigate('/brain/cecelia')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft className="w-4 h-4" />
          返回总览
        </button>
        <div className="text-center text-slate-500 py-12">服务器不存在</div>
      </div>
    );
  }

  const isOnline = server.status === 'online';
  const cpuDanger = server.resources && server.resources.cpu_pct > 80;
  const memDanger = server.resources && server.resources.mem_used_pct > 80;

  // 区分有头和无头
  const headlessProcesses = server.slots.processes.filter(p => p.command?.includes('-p'));
  const headedProcesses = server.slots.processes.filter(p => p.command && !p.command.includes('-p'));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/brain/cecelia')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            isOnline ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-red-500 to-red-600'
          }`}>
            <Server className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{server.location}</h1>
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="font-mono">{server.ip}</span>
              <span className="flex items-center gap-1">
                {isOnline ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-red-500" />}
                {isOnline ? '在线' : '离线'}
              </span>
            </div>
          </div>
        </div>
        <button onClick={fetchData} className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700">
          <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Resource Meters - 大卡片 */}
      {server.resources && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cpuDanger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                <Cpu className={`w-5 h-5 ${cpuDanger ? 'text-red-500' : 'text-blue-500'}`} />
              </div>
              <span className="text-slate-600 dark:text-slate-300 font-medium">CPU</span>
            </div>
            <div className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
              {server.resources.cpu_pct}%
            </div>
            <div className="text-sm text-slate-500 mb-3">
              负载 {server.resources.cpu_load} / {server.resources.cpu_cores} 核心
            </div>
            <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${cpuDanger ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, server.resources.cpu_pct)}%` }}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${memDanger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'}`}>
                <HardDrive className={`w-5 h-5 ${memDanger ? 'text-red-500' : 'text-emerald-500'}`} />
              </div>
              <span className="text-slate-600 dark:text-slate-300 font-medium">内存</span>
            </div>
            <div className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
              {server.resources.mem_used_pct}%
            </div>
            <div className="text-sm text-slate-500 mb-3">
              {server.resources.mem_free_gb}GB 空闲 / {server.resources.mem_total_gb}GB 总计
            </div>
            <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${memDanger ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${server.resources.mem_used_pct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Seats 完整可视化 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">席位状态</h2>
          <div className="text-sm text-slate-500">
            {server.slots.used}/{server.slots.dynamic_max} 使用中（最大 {server.slots.max}）
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
            <div className="text-2xl font-bold text-blue-600">{headlessProcesses.length}</div>
            <div className="text-xs text-slate-500">无头 (auto)</div>
          </div>
          <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
            <div className="text-2xl font-bold text-emerald-600">{headedProcesses.length}</div>
            <div className="text-xs text-slate-500">有头 (manual)</div>
          </div>
          <div className="text-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
            <div className="text-2xl font-bold text-slate-600 dark:text-slate-300">{server.slots.available}</div>
            <div className="text-xs text-slate-500">可用</div>
          </div>
          <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
            <div className="text-2xl font-bold text-amber-600">{server.slots.reserved}</div>
            <div className="text-xs text-slate-500">预留</div>
          </div>
        </div>

        {/* 席位可视化 */}
        <div className="flex gap-2 flex-wrap">
          {/* 无头进程 */}
          {headlessProcesses.map((_, i) => (
            <div key={`hl-${i}`} className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
          ))}
          {/* 有头进程 */}
          {headedProcesses.map((_, i) => (
            <div key={`hd-${i}`} className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-sm">
              <User className="w-4 h-4" />
            </div>
          ))}
          {/* 可用席位 */}
          {Array.from({ length: Math.max(0, server.slots.dynamic_max - server.slots.used - server.slots.reserved) }, (_, i) => (
            <div key={`av-${i}`} className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-400 flex items-center justify-center text-sm">
              {server.slots.used + i + 1}
            </div>
          ))}
          {/* 预留席位 */}
          {server.slots.reserved > 0 && (
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 border-2 border-dashed border-amber-300 flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          )}
          {/* 资源不足席位 */}
          {Array.from({ length: Math.max(0, server.slots.max - server.slots.dynamic_max) }, (_, i) => (
            <div key={`dis-${i}`} className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 flex items-center justify-center text-sm border border-slate-200 dark:border-slate-700 opacity-50">
              {server.slots.dynamic_max + i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* 运行中的进程 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">运行中的进程</h2>
        {server.slots.processes.length > 0 ? (
          <div className="space-y-3">
            {server.slots.processes.map((proc, i) => {
              const isHeaded = !proc.command?.includes('-p');
              const taskMatch = proc.command?.match(/PRD - ([^#]+)/);
              const taskName = taskMatch ? taskMatch[1].trim() : null;
              const repoMatch = proc.command?.match(/dev\/([^/\s]+)/);
              const repoName = repoMatch ? repoMatch[1] : null;

              return (
                <div key={i} className={`p-4 rounded-xl border ${
                  isHeaded
                    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                    : 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                        isHeaded
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300'
                      }`}>
                        {isHeaded ? 'manual' : 'auto'}
                      </span>
                      <span className="font-mono text-sm text-slate-500">PID {proc.pid}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" /> {proc.cpu}
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" /> {proc.memory}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {proc.startTime}
                      </span>
                    </div>
                  </div>
                  {(taskName || repoName) && (
                    <div className="flex items-center gap-3 text-sm">
                      {repoName && (
                        <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                          <GitBranch className="w-3.5 h-3.5" />
                          {repoName}
                        </span>
                      )}
                      {taskName && (
                        <span className="text-slate-700 dark:text-slate-300">{taskName}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-slate-400 py-8">暂无运行中的进程</div>
        )}
      </div>

      {/* 支持的任务类型 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">支持的任务类型</h2>
        <div className="flex gap-2 flex-wrap">
          {server.task_types.map(type => (
            <span key={type} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300">
              {type}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
