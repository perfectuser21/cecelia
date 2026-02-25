import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  XCircle,
  Clock,
  Server,
  Cpu,
  MemoryStick,
  Timer,
  Shield,
  DollarSign,
  Zap,
  Eye,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────

interface HealthData {
  status: string;
  organs: {
    scheduler: { status: string; enabled: boolean; last_tick: string; max_concurrent: number };
    circuit_breaker: { status: string; open: string[]; states: Record<string, BreakerState> };
    event_bus: { status: string };
    notifier: { status: string };
    planner: { status: string };
  };
  timestamp: string;
}

interface BreakerState {
  state: string;
  failures: number;
  lastFailureAt: string | null;
  openedAt: string | null;
}

interface ClusterServer {
  id: string;
  name: string;
  location: string;
  ip: string;
  status: string;
  resources: {
    cpu_cores: number;
    cpu_load: number;
    cpu_pct: number;
    mem_total_gb: number;
    mem_free_gb: number;
    mem_used_pct: number;
  };
  slots: {
    max: number;
    dynamic_max: number;
    used: number;
    available: number;
    reserved: number;
    processes: Array<{
      pid: number;
      cpu: string;
      memory: string;
      startTime: string;
      command: string;
    }>;
  };
}

interface ClusterData {
  success: boolean;
  cluster: {
    total_slots: number;
    total_used: number;
    total_available: number;
    servers: ClusterServer[];
  };
}

interface TickData {
  enabled: boolean;
  loop_running: boolean;
  interval_minutes: number;
  last_tick: string;
  next_tick: string;
  actions_today: number;
  tick_running: boolean;
  last_dispatch: {
    run_id: string;
    success: boolean;
    task_id: string;
    task_title: string;
    dispatched_at: string;
  } | null;
  max_concurrent: number;
}

interface AlertnessData {
  success: boolean;
  level: number;
  name: string;
  behavior: {
    name: string;
    description: string;
    dispatch_enabled: boolean;
    dispatch_rate: number;
  };
}

interface CircuitBreakerData {
  success: boolean;
  breakers: Record<string, BreakerState>;
}

interface TokenData {
  success: boolean;
  date: string;
  total_cost_usd: number;
  breakdown: Array<{ source: string; cost: number }>;
}

interface VpsSlot {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  taskId: string | null;
  runId: string | null;
  taskTitle: string | null;
  taskPriority: string | null;
  command: string;
}

interface VpsSlotsData {
  success: boolean;
  total: number;
  used: number;
  available: number;
  slots: VpsSlot[];
}

// ── Fetch helpers ──────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ── Component ──────────────────────────────────────────

export default function OpsDashboard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [cluster, setCluster] = useState<ClusterData | null>(null);
  const [tick, setTick] = useState<TickData | null>(null);
  const [alertness, setAlertness] = useState<AlertnessData | null>(null);
  const [breakers, setBreakers] = useState<CircuitBreakerData | null>(null);
  const [token, setToken] = useState<TokenData | null>(null);
  const [slots, setSlots] = useState<VpsSlotsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [h, c, t, a, b, tk, s, scanRes] = await Promise.all([
        fetchJson<HealthData>('/api/brain/health'),
        fetchJson<ClusterData>('/api/brain/cluster/status'),
        fetchJson<TickData>('/api/brain/tick/status'),
        fetchJson<AlertnessData>('/api/brain/alertness'),
        fetchJson<CircuitBreakerData>('/api/brain/circuit-breaker'),
        fetchJson<TokenData>('/api/brain/token-usage'),
        fetchJson<VpsSlotsData>('/api/brain/vps-slots'),
        fetchJson<{ processes: ClusterServer['slots']['processes']; total: number }>('/api/cluster/scan-sessions').catch(() => null),
      ]);
      setHealth(h);
      // Brain 容器无 --pid=host，ps aux 看不到宿主机进程。
      // 用 Core server 扫描的结果覆盖 US 服务器的 processes。
      if (c?.cluster?.servers?.[0] && scanRes?.processes) {
        c.cluster.servers[0].slots.processes = scanRes.processes;
        c.cluster.servers[0].slots.used = scanRes.total;
      }
      setCluster(c);
      setTick(t);
      setAlertness(a);
      setBreakers(b);
      setToken(tk);
      // Brain 容器无 --pid=host，vps-slots 看不到宿主机进程。
      // 用 Core server 扫描的结果覆盖 slots state。
      if (scanRes?.processes && scanRes.processes.length > 0) {
        setSlots({
          success: true,
          total: 12,
          used: scanRes.total,
          available: Math.max(0, 12 - scanRes.total),
          slots: scanRes.processes.map(p => ({
            pid: p.pid,
            cpu: p.cpu,
            memory: p.memory,
            startTime: p.startTime,
            taskId: null,
            runId: null,
            taskTitle: null,
            taskPriority: null,
            command: p.command,
          })),
        });
      } else {
        setSlots(s);
      }
      setError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const fast = setInterval(fetchAll, 10000);
    return () => clearInterval(fast);
  }, [fetchAll]);

  // ── Helpers ────────────────────────────────────────

  const alertnessColor = (name: string) => {
    if (name === 'NORMAL') return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' };
    if (name === 'ALERT') return { bg: 'bg-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' };
    return { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400' };
  };

  const statusDot = (ok: boolean) =>
    ok ? 'bg-emerald-400' : 'bg-red-400';

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '-';
    }
  };

  const formatRelative = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    } catch {
      return '-';
    }
  };

  // ── Loading / Error ────────────────────────────────

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">Failed to load: {error}</p>
        <button onClick={fetchAll} className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const servers = cluster?.cluster?.servers || [];
  const usServer = servers.find(s => s.id === 'us');
  const hkServer = servers.find(s => s.id === 'hk');
  const ac = alertnessColor(alertness?.name || 'NORMAL');
  const openBreakers = breakers ? Object.entries(breakers.breakers).filter(([, v]) => v.state !== 'CLOSED') : [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Ops Dashboard</h1>
            <p className="text-gray-400">Cluster & Brain real-time monitoring</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button onClick={fetchAll} className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* VPS Comparison Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VpsCard server={usServer} label="US VPS" flag="🇺🇸" health={health} />
        <VpsCard server={hkServer} label="HK VPS" flag="🇭🇰" />
      </div>

      {/* System Status Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tick Status */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Timer className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-white">Tick Loop</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${tick?.loop_running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <span className={`text-sm ${tick?.loop_running ? 'text-emerald-400' : 'text-red-400'}`}>
              {tick?.loop_running ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <div>Last: {tick?.last_tick ? formatRelative(tick.last_tick) : '-'}</div>
            <div>Actions today: {tick?.actions_today ?? 0}</div>
          </div>
        </div>

        {/* Alertness */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-white">Alertness</span>
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${ac.bg}`}>
            <div className={`w-2 h-2 rounded-full ${ac.dot}`} />
            <span className={`text-sm font-medium ${ac.text}`}>{alertness?.name || 'UNKNOWN'}</span>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Dispatch: {alertness?.behavior?.dispatch_enabled ? 'enabled' : 'disabled'}
          </div>
        </div>

        {/* Token Usage */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-white">Token Usage</span>
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            ${(token?.total_cost_usd ?? 0).toFixed(2)}
          </div>
          <div className="text-xs text-gray-500">Today ({token?.date || '-'})</div>
        </div>

        {/* Circuit Breakers */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-white">Circuit Breakers</span>
          </div>
          {openBreakers.length === 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-emerald-400">All Closed</span>
            </div>
          ) : (
            <div className="space-y-1">
              {openBreakers.map(([name, state]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-xs text-red-400">{name}: {state.state}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-gray-500 mt-2">
            {breakers ? Object.keys(breakers.breakers).length : 0} total
          </div>
        </div>
      </div>

      {/* Last Dispatch */}
      {tick?.last_dispatch && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-gray-400">Last Dispatch:</span>
              <span className="text-white font-medium truncate max-w-md">{tick.last_dispatch.task_title}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded text-xs ${tick.last_dispatch.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                {tick.last_dispatch.success ? 'success' : 'failed'}
              </span>
              <span className="text-gray-500 text-xs">{formatRelative(tick.last_dispatch.dispatched_at)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Processes */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            <span className="font-medium text-white">Active Processes</span>
          </div>
          <span className="text-sm text-gray-400">
            {slots?.used ?? 0} / {slots?.total ?? 0} slots
          </span>
        </div>
        {slots?.slots && slots.slots.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-slate-700/50">
                  <th className="text-left p-3 font-medium">PID</th>
                  <th className="text-left p-3 font-medium">Task</th>
                  <th className="text-right p-3 font-medium">CPU</th>
                  <th className="text-right p-3 font-medium">Memory</th>
                  <th className="text-right p-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {slots.slots.map((slot) => (
                  <tr key={slot.pid} className="hover:bg-slate-700/30 transition-colors">
                    <td className="p-3 font-mono text-gray-300">{slot.pid}</td>
                    <td className="p-3 text-white truncate max-w-xs">
                      {slot.taskTitle || slot.command}
                      {slot.taskPriority && (
                        <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                          slot.taskPriority === 'P0' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {slot.taskPriority}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-cyan-400">{slot.cpu}</td>
                    <td className="p-3 text-right font-mono text-purple-400">{slot.memory}</td>
                    <td className="p-3 text-right text-gray-500">{slot.startTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Cpu className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No active processes</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── VPS Card Sub-component ─────────────────────────────

function VpsCard({ server, label, flag, health }: {
  server: ClusterServer | undefined;
  label: string;
  flag: string;
  health?: HealthData | null;
}) {
  if (!server) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">{flag}</span>
          <h3 className="font-semibold text-white">{label}</h3>
          <span className="ml-auto px-2 py-0.5 text-xs rounded bg-slate-700 text-gray-400">offline</span>
        </div>
        <p className="text-sm text-gray-500">Not available</p>
      </div>
    );
  }

  const cpuPct = server.resources.cpu_pct;
  const memPct = server.resources.mem_used_pct;
  const cpuColor = cpuPct > 80 ? 'text-red-400' : cpuPct > 50 ? 'text-amber-400' : 'text-emerald-400';
  const memColor = memPct > 80 ? 'text-red-400' : memPct > 50 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xl">{flag}</span>
        <h3 className="font-semibold text-white">{label}</h3>
        <span className="text-xs text-gray-500">{server.ip}</span>
        <span className={`ml-auto px-2 py-0.5 text-xs rounded ${
          server.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {server.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* CPU */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Cpu className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-400">CPU</span>
          </div>
          <div className={`text-xl font-bold ${cpuColor}`}>{cpuPct}%</div>
          <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${
              cpuPct > 80 ? 'bg-red-500' : cpuPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
            }`} style={{ width: `${cpuPct}%` }} />
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <MemoryStick className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-400">Memory</span>
          </div>
          <div className={`text-xl font-bold ${memColor}`}>{memPct}%</div>
          <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${
              memPct > 80 ? 'bg-red-500' : memPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
            }`} style={{ width: `${memPct}%` }} />
          </div>
        </div>

        {/* Slots */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Server className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-400">Slots</span>
          </div>
          <div className="text-xl font-bold text-blue-400">
            {server.slots.used}<span className="text-sm text-gray-500">/{server.slots.dynamic_max}</span>
          </div>
          <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${server.slots.dynamic_max > 0 ? (server.slots.used / server.slots.dynamic_max) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      {/* Brain Status (only for US) */}
      {health && (
        <div className="pt-3 border-t border-slate-700/50">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Brain:</span>
            <div className={`w-1.5 h-1.5 rounded-full ${health.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className={health.status === 'healthy' ? 'text-emerald-400' : 'text-red-400'}>
              {health.status}
            </span>
            <span className="mx-2 text-slate-600">|</span>
            {Object.entries(health.organs).slice(0, 3).map(([name, organ]) => (
              <span key={name} className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${
                  organ.status === 'running' || organ.status === 'active' || organ.status === 'all_closed' || organ.status === 'v2'
                    ? 'bg-emerald-400' : organ.status === 'unconfigured' ? 'bg-gray-500' : 'bg-red-400'
                }`} />
                <span className="text-gray-500">{name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
