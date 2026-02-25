import { useState, useEffect } from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Activity,
  Container,
  Server,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  TrendingUp,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  vpsMonitorApi,
  SystemStats,
  ContainerInfo,
  ServiceInfo,
  MetricPoint,
} from '../api/vps-monitor.api';

export default function VpsMonitor() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [containerCount, setContainerCount] = useState({ running: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [history, setHistory] = useState<MetricPoint[]>([]);
  const [timeRange, setTimeRange] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [statsRes, containersRes, servicesRes] = await Promise.all([
        vpsMonitorApi.getStats(),
        vpsMonitorApi.getContainers(),
        vpsMonitorApi.getServices(),
      ]);

      setStats(statsRes);
      setContainers(containersRes.containers || []);
      setContainerCount({ running: containersRes.running || 0, total: containersRes.total || 0 });
      setServices(servicesRes.services || []);
      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await vpsMonitorApi.getHistory(timeRange);
      setHistory(data);
    } catch {
      // Error handled silently - chart will show empty state
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
    fetchHistory();
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 60000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  };

  const getStatusColor = (status: string): string => {
    if (status.includes('Up') || status === 'running') return 'text-green-600 bg-green-100';
    if (status.includes('Exited') || status === 'stopped') return 'text-red-600 bg-red-100';
    return 'text-yellow-600 bg-yellow-100';
  };

  const getStatusIcon = (status: string) => {
    if (status.includes('Up') || status === 'running') return <CheckCircle2 className="w-4 h-4" />;
    if (status.includes('Exited') || status === 'stopped') return <XCircle className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
  };

  const getProgressColor = (percent: number): string => {
    if (percent < 60) return 'bg-green-500';
    if (percent < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Mini chart component
  const MiniChart = ({
    data,
    dataKey,
    color,
    title,
    icon: Icon,
    currentValue,
    unit = '%'
  }: {
    data: MetricPoint[];
    dataKey: string;
    color: string;
    title: string;
    icon: React.ElementType;
    currentValue: number | string;
    unit?: string;
  }) => (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)`, boxShadow: `0 8px 16px ${color}40` }}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {currentValue}{unit}
            </div>
          </div>
        </div>
      </div>
      <div className="h-24">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${dataKey})`}
                isAnimationActive={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  padding: '8px 12px',
                }}
                labelStyle={{ color: '#6b7280', fontSize: '12px' }}
                formatter={(value: number) => [`${value}${unit}`, title]}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
            数据采集中...
          </div>
        )}
      </div>
    </div>
  );

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          重试
        </button>
      </div>
    );
  }

  const timeRangeOptions = [
    { value: 1, label: '1小时' },
    { value: 6, label: '6小时' },
    { value: 24, label: '24小时' },
    { value: 168, label: '7天' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">VPS 监控</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {stats?.hostname} · {stats?.platform} · 更新于 {lastUpdate}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Time range buttons */}
          <div className="flex bg-gray-100 dark:bg-slate-700 rounded-xl p-1">
            {timeRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                  timeRange === opt.value
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || historyLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25 magnetic-btn"
          >
            <RefreshCw className={`w-4 h-4 ${(loading || historyLoading) ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Main metrics with mini charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniChart
          data={history}
          dataKey="cpu"
          color="#3b82f6"
          title="CPU 使用率"
          icon={Cpu}
          currentValue={stats?.cpu.usage || 0}
        />
        <MiniChart
          data={history}
          dataKey="memory"
          color="#8b5cf6"
          title="内存使用率"
          icon={MemoryStick}
          currentValue={stats?.memory.usagePercent || 0}
        />
        <MiniChart
          data={history}
          dataKey="disk"
          color="#f59e0b"
          title="磁盘使用率"
          icon={HardDrive}
          currentValue={stats?.disk.usagePercent?.toString().replace('%', '') || 0}
        />
        {/* 系统负载卡片 - 不用图表，显示 1/5/15 分钟负载 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">系统负载</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {stats?.cpu.loadAverage?.['1min']?.toFixed(2) || '-'}
              </div>
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <div className="text-center">
              <div className="text-gray-400 dark:text-gray-500">1分钟</div>
              <div className="font-semibold text-gray-700 dark:text-gray-300">{stats?.cpu.loadAverage?.['1min']?.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 dark:text-gray-500">5分钟</div>
              <div className="font-semibold text-gray-700 dark:text-gray-300">{stats?.cpu.loadAverage?.['5min']?.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-gray-400 dark:text-gray-500">15分钟</div>
              <div className="font-semibold text-gray-700 dark:text-gray-300">{stats?.cpu.loadAverage?.['15min']?.toFixed(2)}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 text-center">
            {(stats?.cpu.loadAverage?.['1min'] || 0) > 8 ? '⚠️ 负载过高' : '✓ 负载正常'} (8核CPU)
          </div>
        </div>
      </div>

      {/* Combined trend chart */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 shimmer-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">资源趋势</h2>
            <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">
              {history.length} 个数据点
              {history.length < 60 && (
                <span className="text-amber-500 dark:text-amber-400 ml-2">
                  (数据采集中，约 {history.length} 分钟)
                </span>
              )}
            </span>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-gray-600 dark:text-gray-400">CPU</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <span className="text-gray-600 dark:text-gray-400">内存</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-gray-600 dark:text-gray-400">磁盘</span>
            </div>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <Activity className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-gray-500 dark:text-gray-400">暂无历史数据</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">每分钟自动采集，请稍候...</p>
            </div>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  dy={10}
                />
                <YAxis
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  dx={-10}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.98)',
                    border: 'none',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                    padding: '12px 16px',
                  }}
                  labelStyle={{ color: '#374151', fontWeight: 600, marginBottom: '8px' }}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = {
                      cpu: 'CPU',
                      memory: '内存',
                      disk: '磁盘',
                    };
                    return [`${value}%`, labels[name] || name];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorCpu)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#3b82f6' }}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#colorMem)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#8b5cf6' }}
                />
                <Area
                  type="monotone"
                  dataKey="disk"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#colorDisk)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#f59e0b' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* System Info Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">系统运行时间</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">{formatUptime(stats?.uptime || 0)}</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">CPU 信息</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{stats?.cpu.cores} 核 · {stats?.cpu.model}</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 tilt-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
              <MemoryStick className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">内存信息</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatBytes(stats?.memory.used || 0)} / {formatBytes(stats?.memory.total || 0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Services */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">关键服务</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((service) => (
              <div
                key={service.name}
                className="border border-gray-200 dark:border-slate-600 rounded-xl p-4 hover:shadow-md dark:hover:shadow-slate-900/50 hover:border-gray-300 dark:hover:border-slate-500 transition-all bg-white dark:bg-slate-700/50"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900 dark:text-white">{service.name}</h3>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                    service.status.includes('Up') || service.status === 'running'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  }`}>
                    {getStatusIcon(service.status)}
                    {service.status}
                  </span>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
                  <div>端口: <span className="font-mono text-gray-700 dark:text-gray-300">{service.port}</span></div>
                  <div>容器: <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{service.containerName}</span></div>
                  {service.uptime && <div className="text-gray-400 dark:text-gray-500">运行 {service.uptime}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Containers */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Container className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Docker 容器</h2>
            </div>
            <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm font-medium">
              {containerCount.running} / {containerCount.total} 运行中
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">容器</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPU 使用率</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">内存使用率</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">内存详情</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">端口</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {containers.map((container, idx) => (
                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <Container className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{container.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                      container.status.includes('Up') || container.status === 'running'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {container.status.split(' ')[0]}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressColor(container.cpuPercent || 0)}`}
                          style={{ width: `${Math.min(container.cpuPercent || 0, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono text-gray-700 dark:text-gray-300 w-14">{container.cpu || '-'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressColor((container.memoryPercent || 0) * 10)}`}
                          style={{ width: `${Math.min((container.memoryPercent || 0) * 10, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono text-gray-700 dark:text-gray-300 w-14">
                        {container.memoryPercent !== undefined ? `${container.memoryPercent.toFixed(1)}%` : '-'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{container.memory || '-'}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">
                    {container.ports || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
