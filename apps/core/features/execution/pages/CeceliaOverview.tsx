import { useEffect, useState, useCallback } from 'react';
import {
  Bot,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  Zap,
  Clock,
  Users,
  AlertTriangle,
  PlayCircle,
  List,
} from 'lucide-react';
import {
  fetchCeceliaOverview,
  fetchTimelineData,
  fetchClusterStatus,
  CeceliaOverview,
  TimeRange,
  TimelineData,
  ClusterStatus as ClusterStatusType,
} from '../api/agents.api';
import TimeRangeSelector from '../components/TimeRangeSelector';
import TimelineView from '../components/TimelineView';
import ClusterStatus from '../components/ClusterStatus';

// Brain API 数据类型
interface BrainStatus {
  enabled: boolean;
  loop_running: boolean;
  loop_interval_ms: number;
  last_tick: string;
  next_tick: string;
  actions_today: number;
  max_concurrent: number;
  circuit_breakers: {
    [key: string]: {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failures: number;
      last_failure_time?: string;
    };
  };
}

// Tasks 数据类型
interface Task {
  id: string;
  title: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
}

// 任务统计类型
interface TaskStats {
  queued: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

// Brain API - use backend proxy to avoid CORS
const BRAIN_API_URL = '/api/brain';

export default function CeceliaOverviewPage() {
  const [overview, setOverview] = useState<CeceliaOverview | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatusType | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  const loadData = useCallback(async () => {
    try {
      const [overviewData, timelineData, brainData, clusterData, tasksData] = await Promise.all([
        fetchCeceliaOverview(timeRange),
        fetchTimelineData(),
        fetch(`${BRAIN_API_URL}/tick/status`).then(r => {
          if (!r.ok) throw new Error(`Brain API failed: ${r.status}`);
          return r.json();
        }).catch(err => {
          console.warn('Brain API error:', err);
          return null;
        }),
        fetchClusterStatus().catch(err => {
          console.warn('Cluster status error:', err);
          return null;
        }),
        fetch('/api/tasks/tasks').then(r => {
          if (!r.ok) throw new Error(`Tasks API failed: ${r.status}`);
          return r.json();
        }).catch(err => {
          console.warn('Tasks API error:', err);
          return [];
        }),
      ]);
      setOverview(overviewData);
      setTimeline(timelineData);
      setBrainStatus(brainData);
      setClusterStatus(clusterData);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const getTimeRangeLabel = (range: TimeRange): string => {
    switch (range) {
      case '24h':
        return '过去 24 小时';
      case '72h':
        return '过去 72 小时';
      case '7d':
        return '过去 7 天';
    }
  };

  // 计算任务统计
  const taskStats: TaskStats = tasks.reduce(
    (acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    },
    { queued: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 }
  );

  // 计算座位使用情况
  const usedSeats = taskStats.in_progress || 0;
  const maxSeats = brainStatus?.max_concurrent || 0;
  const availableSeats = maxSeats - usedSeats;

  // 获取当前正在执行的任务
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">加载失败: {error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const periodStats = overview?.periodStats;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Cecelia</h1>
            <p className="text-gray-400">
              无头 Claude Code · {timeline?.totalProjects || 0} 项目 · {timeline?.totalFeatures || 0} Features · {getTimeRangeLabel(timeRange)} {periodStats?.total || 0} 次任务
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          {lastUpdate && (
            <span className="text-sm text-gray-500">
              {lastUpdate.toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4 text-white" />}
          label="运行中"
          value={periodStats?.running || 0}
          color="from-blue-500 to-cyan-600"
          animate={periodStats && periodStats.running > 0}
        />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4 text-white" />}
          label="成功"
          value={periodStats?.success || 0}
          color="from-green-500 to-emerald-600"
        />
        <StatCard
          icon={<XCircle className="w-4 h-4 text-white" />}
          label="失败"
          value={periodStats?.error || 0}
          color="from-red-500 to-rose-600"
        />
        <StatCard
          icon={<Zap className="w-4 h-4 text-white" />}
          label="总数"
          value={periodStats?.total || 0}
          color="from-purple-500 to-violet-600"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4 text-white" />}
          label="成功率"
          value={`${periodStats?.successRate || 0}%`}
          color="from-emerald-500 to-teal-600"
        />
      </div>

      {/* 集群状态 */}
      <ClusterStatus data={clusterStatus} loading={loading} />

      {/* Cecelia 实时状态面板 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Seats 配置 */}
        <InfoCard title="Seats 配置" icon={<Users className="w-5 h-5" />}>
          <div className="space-y-3">
            <InfoRow label="最大并发" value={maxSeats} />
            <InfoRow label="使用中" value={usedSeats} highlight={usedSeats > 0} />
            <InfoRow label="可用" value={availableSeats} />
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">使用率</span>
                <span className="text-white font-medium">
                  {maxSeats > 0 ? Math.round((usedSeats / maxSeats) * 100) : 0}%
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all"
                  style={{ width: `${maxSeats > 0 ? (usedSeats / maxSeats) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </InfoCard>

        {/* 2. Tick Loop 状态 */}
        <InfoCard title="Tick Loop" icon={<Clock className="w-5 h-5" />}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${brainStatus?.enabled && brainStatus?.loop_running ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
              <span className="text-sm text-gray-400">
                {brainStatus?.enabled && brainStatus?.loop_running ? '运行中' : '已停止'}
              </span>
            </div>
            <InfoRow
              label="循环间隔"
              value={`${brainStatus?.loop_interval_ms ? Math.round(brainStatus.loop_interval_ms / 60000) : 0} 分钟`}
            />
            <InfoRow
              label="今日动作"
              value={brainStatus?.actions_today || 0}
              highlight={brainStatus && brainStatus.actions_today > 0}
            />
            <div className="text-xs text-gray-500 mt-2">
              <div>上次: {brainStatus?.last_tick ? new Date(brainStatus.last_tick).toLocaleTimeString('zh-CN') : '-'}</div>
              <div>下次: {brainStatus?.next_tick ? new Date(brainStatus.next_tick).toLocaleTimeString('zh-CN') : '-'}</div>
            </div>
          </div>
        </InfoCard>

        {/* 3. 熔断器状态 */}
        <InfoCard title="熔断器" icon={<AlertTriangle className="w-5 h-5" />}>
          <div className="space-y-2">
            {brainStatus?.circuit_breakers && Object.entries(brainStatus.circuit_breakers).map(([name, cb]) => (
              <div key={name} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg">
                <div>
                  <div className="text-sm text-white font-medium">{name}</div>
                  <div className="text-xs text-gray-500">失败: {cb.failures}</div>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  cb.state === 'CLOSED' ? 'bg-green-500/20 text-green-400' :
                  cb.state === 'OPEN' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {cb.state}
                </div>
              </div>
            ))}
            {!brainStatus?.circuit_breakers && (
              <div className="text-sm text-gray-500">暂无数据</div>
            )}
          </div>
        </InfoCard>
      </div>

      {/* 新增：任务队列统计 */}
      <InfoCard title="任务队列统计" icon={<List className="w-5 h-5" />}>
        <div className="grid grid-cols-5 gap-4">
          <TaskStatItem label="队列中" value={taskStats.queued} color="text-yellow-400" />
          <TaskStatItem label="执行中" value={taskStats.in_progress} color="text-blue-400" />
          <TaskStatItem label="已完成" value={taskStats.completed} color="text-green-400" />
          <TaskStatItem label="失败" value={taskStats.failed} color="text-red-400" />
          <TaskStatItem label="取消" value={taskStats.cancelled} color="text-gray-400" />
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="w-full bg-slate-700 rounded-full h-3 flex overflow-hidden">
            {taskStats.queued > 0 && (
              <div
                className="bg-yellow-500"
                style={{ width: `${tasks.length > 0 ? (taskStats.queued / tasks.length) * 100 : 0}%` }}
                title={`队列中: ${taskStats.queued}`}
              />
            )}
            {taskStats.in_progress > 0 && (
              <div
                className="bg-blue-500"
                style={{ width: `${tasks.length > 0 ? (taskStats.in_progress / tasks.length) * 100 : 0}%` }}
                title={`执行中: ${taskStats.in_progress}`}
              />
            )}
            {taskStats.completed > 0 && (
              <div
                className="bg-green-500"
                style={{ width: `${tasks.length > 0 ? (taskStats.completed / tasks.length) * 100 : 0}%` }}
                title={`已完成: ${taskStats.completed}`}
              />
            )}
            {taskStats.failed > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${tasks.length > 0 ? (taskStats.failed / tasks.length) * 100 : 0}%` }}
                title={`失败: ${taskStats.failed}`}
              />
            )}
            {taskStats.cancelled > 0 && (
              <div
                className="bg-gray-500"
                style={{ width: `${tasks.length > 0 ? (taskStats.cancelled / tasks.length) * 100 : 0}%` }}
                title={`取消: ${taskStats.cancelled}`}
              />
            )}
          </div>
        </div>
      </InfoCard>

      {/* 新增：当前活动 */}
      {inProgressTasks.length > 0 && (
        <InfoCard title="当前正在执行" icon={<PlayCircle className="w-5 h-5" />}>
          <div className="space-y-2">
            {inProgressTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                <div>
                  <div className="text-sm text-white font-medium">{task.title}</div>
                  <div className="text-xs text-gray-500">
                    开始于 {new Date(task.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-xs text-blue-400">运行中</span>
                </div>
              </div>
            ))}
          </div>
        </InfoCard>
      )}

      {/* 项目时间线 */}
      {timeline && <TimelineView data={timeline} />}
    </div>
  );
}

// 统计卡片组件
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  animate?: boolean;
}

function StatCard({ icon, label, value, color, animate }: StatCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center shadow-lg ${animate ? 'animate-pulse' : ''}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-gray-400">{label}</div>
          <div className="text-xl font-bold text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}

// 信息卡片组件
interface InfoCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function InfoCard({ title, icon, children }: InfoCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-violet-400">{icon}</div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// 信息行组件
interface InfoRowProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function InfoRow({ label, value, highlight }: InfoRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-blue-400' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

// 任务统计项组件
interface TaskStatItemProps {
  label: string;
  value: number;
  color: string;
}

function TaskStatItem({ label, value, color }: TaskStatItemProps) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
