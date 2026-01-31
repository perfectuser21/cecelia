import { useEffect, useState } from 'react';
import {
  Bot,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  fetchCeceliaOverview,
  fetchTimelineData,
  CeceliaOverview,
  TimeRange,
  TimelineData,
} from '../api/agents.api';
import TimeRangeSelector from '../components/TimeRangeSelector';
import TimelineView from '../components/TimelineView';

export default function CeceliaOverviewPage() {
  const [overview, setOverview] = useState<CeceliaOverview | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  const loadData = async () => {
    try {
      const [overviewData, timelineData] = await Promise.all([
        fetchCeceliaOverview(timeRange),
        fetchTimelineData(),
      ]);
      setOverview(overviewData);
      setTimeline(timelineData);
      setError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [timeRange]);

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
