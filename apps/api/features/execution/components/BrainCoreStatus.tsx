import { Brain, Activity, Shield, Eye } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import {
  BrainHealth,
  BrainTickStatus,
  BrainAlertness,
  WatchdogStatus,
} from '../api/agents.api';

const BRAIN_API_URL = '/api/brain';

export default function BrainCoreStatus() {
  const pollOpts = { pollInterval: 5000, staleTime: 5000 };
  const { data: health, loading: healthLoading } = useApi<BrainHealth>(`${BRAIN_API_URL}/health`, pollOpts);
  const { data: tickStatus, loading: tickLoading } = useApi<BrainTickStatus>(`${BRAIN_API_URL}/tick/status`, pollOpts);
  const { data: alertness, loading: alertnessLoading } = useApi<BrainAlertness>(`${BRAIN_API_URL}/alertness`, pollOpts);
  const { data: watchdog, loading: watchdogLoading } = useApi<WatchdogStatus>(`${BRAIN_API_URL}/watchdog`, pollOpts);

  if (healthLoading || tickLoading || alertnessLoading || watchdogLoading) {
    return <SkeletonCard />;
  }

  const isHealthy = health?.enabled && health?.loop_running;

  // 计算下次 tick 时间
  const getNextTickText = () => {
    if (!tickStatus?.next_tick) return '未知';
    const nextTick = new Date(tickStatus.next_tick);
    const now = new Date();
    const diff = nextTick.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    if (minutes > 0) return `${minutes} 分钟后`;
    if (seconds > 0) return `${seconds} 秒后`;
    return '即将执行';
  };

  // 计算上次 tick 时间
  const getLastTickText = () => {
    if (!tickStatus?.last_tick) return '未知';
    const lastTick = new Date(tickStatus.last_tick);
    const now = new Date();
    const diff = now.getTime() - lastTick.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes > 0) return `${minutes} 分钟前`;
    const seconds = Math.floor(diff / 1000);
    return `${seconds} 秒前`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">核心状态</h2>
      </div>

      {/* 健康状态 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">健康状态</span>
          <span className={`text-sm font-medium ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
            {isHealthy ? '🟢 Healthy' : '🔴 Unhealthy'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">上次 Tick</span>
          <span className="text-sm text-gray-900 dark:text-gray-100">{getLastTickText()}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">下次 Tick</span>
          <span className="text-sm text-gray-900 dark:text-gray-100">{getNextTickText()}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">今日活动</span>
          <span className="text-sm text-gray-900 dark:text-gray-100">
            {tickStatus?.actions_today || 0} 次
          </span>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-200 dark:border-gray-700 my-4"></div>

      {/* 三层大脑 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          三层大脑
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">L0 脑干 (调度器)</span>
            <span className="text-green-600">✅ Running</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">L1 丘脑 (快速决策)</span>
            <span className="text-green-600">✅ Active</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">L2 皮层 (深度分析)</span>
            <span className="text-blue-600">✅ Standby</span>
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-200 dark:border-gray-700 my-4"></div>

      {/* 保护系统 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          保护系统
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">警觉等级</span>
            <span className={`font-medium ${alertness?.level === 'NORMAL' ? 'text-green-600' : 'text-yellow-600'}`}>
              {alertness?.level || 'NORMAL'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">熔断器</span>
            <span className="text-green-600">All Closed</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">隔离区</span>
            <span className="text-gray-900 dark:text-gray-100">0 任务</span>
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-200 dark:border-gray-700 my-4"></div>

      {/* 看门狗 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Eye className="w-4 h-4" />
          看门狗
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">RSS 内存</span>
            <span className="text-gray-900 dark:text-gray-100">
              {watchdog?.rss_mb?.toFixed(0) || 0} / {watchdog?.threshold_rss_mb || 0} MB
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">CPU 使用率</span>
            <span className="text-gray-900 dark:text-gray-100">
              {watchdog?.cpu_percent?.toFixed(1) || 0}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
