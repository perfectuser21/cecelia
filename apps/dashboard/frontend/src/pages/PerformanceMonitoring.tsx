import { useState, useEffect, useRef } from 'react';
import { Cpu, HardDrive, Clock, AlertTriangle, RefreshCw, Loader2, XCircle, Activity, Server, TrendingUp, Timer, Pause, ChevronDown, ArrowUpCircle, ArrowDownCircle, Database, Wifi } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { systemApi, SystemMetricsResponse, SystemMetrics, SystemHealthResponse, HealthCheckRecord } from '@/api';
import { ServiceHealthCard } from '@/components';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatMemory(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  }
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${bytesPerSecond.toFixed(0)} B/s`;
}

function getStatusColor(value: number, thresholds: { warn: number; danger: number }): string {
  if (value >= thresholds.danger) return 'text-red-500';
  if (value >= thresholds.warn) return 'text-amber-500';
  return 'text-green-500';
}

function getBarColor(value: number, thresholds: { warn: number; danger: number }): string {
  if (value >= thresholds.danger) return 'bg-red-500';
  if (value >= thresholds.warn) return 'bg-amber-500';
  return 'bg-green-500';
}

// Mock data when API unavailable
function getMockData(): SystemMetricsResponse {
  const now = Date.now();
  return {
    current: {
      cpuUsage: 35 + Math.random() * 20,
      memoryUsage: 62 + Math.random() * 10,
      memoryTotal: 8 * 1024 * 1024 * 1024,
      memoryUsed: 5 * 1024 * 1024 * 1024,
      avgResponseTime: 120 + Math.random() * 80,
      errorRate: 0.1 + Math.random() * 0.5,
      activeConnections: 12 + Math.floor(Math.random() * 8),
      uptime: 86400 * 3 + 3600 * 7,
      diskIO: {
        readSpeed: (50 + Math.random() * 100) * 1024 * 1024,  // 50-150 MB/s
        writeSpeed: (30 + Math.random() * 80) * 1024 * 1024,  // 30-110 MB/s
      },
      networkIO: {
        downloadSpeed: (10 + Math.random() * 50) * 1024 * 1024,  // 10-60 MB/s
        uploadSpeed: (5 + Math.random() * 20) * 1024 * 1024,     // 5-25 MB/s
      },
    },
    history: Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now - (9 - i) * 30000).toISOString(),
      cpuUsage: 30 + Math.random() * 25,
      memoryUsage: 60 + Math.random() * 15,
      responseTime: 100 + Math.random() * 100,
    })),
  };
}

// Service name labels
const SERVICE_LABELS: Record<string, string> = {
  brain: 'Brain',
  workspace: 'Workspace',
  quality: 'Quality',
  n8n: 'N8N',
};

// Refresh interval options
const REFRESH_INTERVALS = [
  { value: 10000, label: '10s' },
  { value: 30000, label: '30s' },
  { value: 60000, label: '60s' },
  { value: 0, label: '暂停' },
] as const;

type RefreshInterval = typeof REFRESH_INTERVALS[number]['value'];

// Maximum number of health check history records to keep per service
const MAX_HEALTH_HISTORY = 20;

export default function PerformanceMonitoring() {
  const [data, setData] = useState<SystemMetricsResponse | null>(null);
  const [healthData, setHealthData] = useState<SystemHealthResponse | null>(null);
  const [healthHistory, setHealthHistory] = useState<Record<string, HealthCheckRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(30000);
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch both metrics and health in parallel
      const [metricsResponse, healthResponse] = await Promise.allSettled([
        systemApi.getMetrics(),
        systemApi.getHealth(),
      ]);

      if (metricsResponse.status === 'fulfilled') {
        setData(metricsResponse.value);
      } else {
        setData(getMockData());
      }

      if (healthResponse.status === 'fulfilled') {
        const newHealthData = healthResponse.value;
        setHealthData(newHealthData);

        // Update health history for each service
        const timestamp = new Date().toISOString();
        setHealthHistory(prevHistory => {
          const newHistory = { ...prevHistory };
          Object.entries(newHealthData.services).forEach(([serviceName, service]) => {
            const record: HealthCheckRecord = {
              timestamp,
              status: service.status,
              latency_ms: service.latency_ms,
              error: service.error,
            };
            const serviceHistory = [...(newHistory[serviceName] || []), record];
            // Keep only the last MAX_HEALTH_HISTORY records
            newHistory[serviceName] = serviceHistory.slice(-MAX_HEALTH_HISTORY);
          });
          return newHistory;
        });
      }

      setError('');
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      // Use mock data when API unavailable
      setData(getMockData());
      setError('');
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on mount and when interval changes
  useEffect(() => {
    fetchData();
  }, []);

  // Manage refresh interval
  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Set new interval if not paused
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refreshInterval]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowIntervalDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getCurrentIntervalLabel = () => {
    const interval = REFRESH_INTERVALS.find(i => i.value === refreshInterval);
    return interval?.label || '30s';
  };

  const metrics: SystemMetrics = data?.current || {
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: 0,
    memoryUsed: 0,
    avgResponseTime: 0,
    errorRate: 0,
    activeConnections: 0,
    uptime: 0,
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <XCircle className="w-5 h-5 mr-2" />{error}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">性能监控</h1>
          <p className="text-sm text-gray-500 mt-1">系统资源和性能指标概览</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Refresh Interval Selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {refreshInterval === 0 ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Timer className="w-3 h-3" />
              )}
              <span>{getCurrentIntervalLabel()}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showIntervalDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showIntervalDropdown && (
              <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-10">
                {REFRESH_INTERVALS.map((interval) => (
                  <button
                    key={interval.value}
                    onClick={() => {
                      setRefreshInterval(interval.value);
                      setShowIntervalDropdown(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      refreshInterval === interval.value
                        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {interval.value === 0 ? (
                      <Pause className="w-3 h-3" />
                    ) : (
                      <Timer className="w-3 h-3" />
                    )}
                    <span>{interval.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs text-gray-400">{lastUpdate} 更新</span>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* CPU Usage */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Cpu className="w-3.5 h-3.5" />
            <span>CPU 使用率</span>
          </div>
          <div className={`text-2xl font-bold ${getStatusColor(metrics.cpuUsage, { warn: 70, danger: 90 })}`}>
            {metrics.cpuUsage.toFixed(1)}%
          </div>
          <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.cpuUsage, { warn: 70, danger: 90 })}`}
              style={{ width: `${Math.min(metrics.cpuUsage, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <HardDrive className="w-3.5 h-3.5" />
            <span>内存使用</span>
          </div>
          <div className={`text-2xl font-bold ${getStatusColor(metrics.memoryUsage, { warn: 75, danger: 90 })}`}>
            {metrics.memoryUsage.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {formatMemory(metrics.memoryUsed)} / {formatMemory(metrics.memoryTotal)}
          </div>
          <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(metrics.memoryUsage, { warn: 75, danger: 90 })}`}
              style={{ width: `${Math.min(metrics.memoryUsage, 100)}%` }}
            />
          </div>
        </div>

        {/* Response Time */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Clock className="w-3.5 h-3.5" />
            <span>平均响应时间</span>
          </div>
          <div className={`text-2xl font-bold ${getStatusColor(metrics.avgResponseTime, { warn: 500, danger: 1000 })}`}>
            {metrics.avgResponseTime.toFixed(0)}ms
          </div>
        </div>

        {/* Error Rate */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>错误率</span>
          </div>
          <div className={`text-2xl font-bold ${getStatusColor(metrics.errorRate, { warn: 1, danger: 5 })}`}>
            {metrics.errorRate.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* I/O Stats Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Disk I/O */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
            <Database className="w-3.5 h-3.5" />
            <span>磁盘 I/O</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <ArrowDownCircle className="w-3 h-3 text-blue-500" />
                <span>读取</span>
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatSpeed(metrics.diskIO?.readSpeed || 0)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <ArrowUpCircle className="w-3 h-3 text-green-500" />
                <span>写入</span>
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatSpeed(metrics.diskIO?.writeSpeed || 0)}
              </div>
            </div>
          </div>
        </div>

        {/* Network I/O */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
            <Wifi className="w-3.5 h-3.5" />
            <span>网络吞吐</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <ArrowDownCircle className="w-3 h-3 text-blue-500" />
                <span>下载</span>
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatSpeed(metrics.networkIO?.downloadSpeed || 0)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <ArrowUpCircle className="w-3 h-3 text-green-500" />
                <span>上传</span>
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatSpeed(metrics.networkIO?.uploadSpeed || 0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Service Health Status */}
      {healthData && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-4">
          <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-50 dark:bg-purple-900/20">
                  <Server className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">服务健康状态</div>
                  <div className="text-xs text-gray-500 mt-0.5">多服务聚合健康检查</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  healthData.status === 'healthy' ? 'bg-green-500' :
                  healthData.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                } animate-pulse`} />
                <span className={`text-sm font-medium ${
                  healthData.status === 'healthy' ? 'text-green-500' :
                  healthData.status === 'degraded' ? 'text-amber-500' : 'text-red-500'
                }`}>
                  {healthData.status === 'healthy' ? '健康' :
                   healthData.status === 'degraded' ? '降级' : '异常'}
                </span>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(healthData.services).map(([name, service]) => (
                <ServiceHealthCard
                  key={name}
                  name={name}
                  label={SERVICE_LABELS[name] || name}
                  service={service}
                  history={healthHistory[name]}
                  onRefresh={fetchData}
                />
              ))}
            </div>
            {healthData.degraded && healthData.degraded_reason && (
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">降级原因: {healthData.degraded_reason}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Status */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-50 dark:bg-blue-900/20">
              <Activity className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-white">系统状态</div>
              <div className="text-xs text-gray-500 mt-0.5">实时运行状态</div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-xs text-gray-500 mb-1">活跃连接</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{metrics.activeConnections}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">运行时间</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{formatUptime(metrics.uptime)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">状态</div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  healthData?.status === 'healthy' ? 'bg-green-500' :
                  healthData?.status === 'degraded' ? 'bg-amber-500' :
                  healthData?.status === 'unhealthy' ? 'bg-red-500' : 'bg-green-500'
                } animate-pulse`} />
                <span className={`text-lg font-semibold ${
                  healthData?.status === 'healthy' ? 'text-green-500' :
                  healthData?.status === 'degraded' ? 'text-amber-500' :
                  healthData?.status === 'unhealthy' ? 'text-red-500' : 'text-green-500'
                }`}>
                  {healthData?.status === 'healthy' ? '正常' :
                   healthData?.status === 'degraded' ? '降级' :
                   healthData?.status === 'unhealthy' ? '异常' : '正常'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History Trend Chart */}
      {data?.history && data.history.length > 0 && (
        <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/20">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">历史趋势</div>
                <div className="text-xs text-gray-500 mt-0.5">最近 5 分钟的性能变化</div>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.history.slice(-10).map(h => ({
                    time: new Date(h.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    cpu: Math.round(h.cpuUsage),
                    memory: Math.round(h.memoryUsage),
                    response: Math.round(h.responseTime),
                  }))}
                  margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    tickLine={{ stroke: '#9CA3AF' }}
                  />
                  <YAxis
                    yAxisId="percent"
                    domain={[0, 100]}
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    tickLine={{ stroke: '#9CA3AF' }}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <YAxis
                    yAxisId="ms"
                    orientation="right"
                    domain={[0, 'auto']}
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    tickLine={{ stroke: '#9CA3AF' }}
                    tickFormatter={(value) => `${value}ms`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(31, 41, 55, 0.95)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#9CA3AF' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px' }}
                    formatter={(value) => {
                      const labels: Record<string, string> = {
                        cpu: 'CPU 使用率',
                        memory: '内存使用率',
                        response: '响应时间',
                      };
                      return labels[value] || value;
                    }}
                  />
                  <Line
                    yAxisId="percent"
                    type="monotone"
                    dataKey="cpu"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="percent"
                    type="monotone"
                    dataKey="memory"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="ms"
                    type="monotone"
                    dataKey="response"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
