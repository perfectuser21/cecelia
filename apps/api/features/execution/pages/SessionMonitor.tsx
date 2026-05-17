import { useState, useEffect } from 'react';
import { getStatusColor, getStatusLabel } from '../../shared/utils/statusHelpers';
import { LoadingState } from '../../shared/components/LoadingState';
import { formatDateTime } from '../../shared/utils/formatters';

interface PlatformStatus {
  name: string;
  status: 'online' | 'offline' | 'unknown';
  currentUrl?: string;
  lastCheck: string;
  error?: string;
}

interface SessionData {
  success: boolean;
  runner_status: 'online' | 'offline';
  last_check: string | null;
  platforms: { [key: string]: PlatformStatus };
  error?: string;
}

const API_BASE = (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_URL) || '';

// Emoji icons for status (different from lucide-react icons)
const getStatusIcon = (status: string) => {
  switch (status) {
    case 'online':
      return '✅';
    case 'offline':
      return '❌';
    default:
      return '❓';
  }
};

export default function SessionMonitor() {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/session/status`);
      const json = await res.json();
      setData(json);
    } catch {
      // Error handled silently - will show loading state
    } finally {
      setLoading(false);
    }
  };

  const triggerCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${API_BASE}/api/session/check`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setData(prev => prev ? {
          ...prev,
          last_check: json.last_check,
          platforms: json.platforms
        } : null);
      }
    } catch {
      // Error handled silently
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Auto refresh every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const platformCount = data?.platforms ? Object.keys(data.platforms).length : 0;
  const onlineCount = data?.platforms ? Object.values(data.platforms).filter(p => p.status === 'online').length : 0;
  const offlineCount = data?.platforms ? Object.values(data.platforms).filter(p => p.status === 'offline').length : 0;

  if (loading && !data) {
    return <LoadingState height="h-96" message="加载 Session 状态..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Session 监控</h1>
          <div className="flex items-center gap-4 mt-1">
            <span className={`inline-flex items-center gap-1 text-sm ${
              data?.runner_status === 'online'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                data?.runner_status === 'online' ? 'bg-green-500' : 'bg-red-500'
              }`}></span>
              Windows Runner {data?.runner_status === 'online' ? '在线' : '离线'}
            </span>
            {data?.last_check && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                上次检查: {formatDateTime(data.last_check)}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={triggerCheck}
          disabled={checking}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          {checking ? '检查中...' : '检查所有平台'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-slate-700 shimmer-card">
        <h2 className="font-semibold mb-4 text-gray-900 dark:text-white">状态汇总</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">{onlineCount}</div>
            <div className="text-sm text-green-600/70 dark:text-green-400/70 mt-1">已登录</div>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{offlineCount}</div>
            <div className="text-sm text-red-600/70 dark:text-red-400/70 mt-1">已掉线</div>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
            <div className="text-3xl font-bold text-gray-600 dark:text-gray-300">{platformCount}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">总平台数</div>
          </div>
        </div>
      </div>

      {/* Platform Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.platforms && Object.entries(data.platforms).map(([key, platform]) => (
          <div
            key={key}
            className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-gray-200 dark:border-slate-700 tilt-card"
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{platform.name}</h3>
              <span className={`px-2.5 py-1 rounded-lg text-sm font-medium ${getStatusColor(platform.status)}`}>
                {getStatusIcon(platform.status)} {getStatusLabel(platform.status)}
              </span>
            </div>

            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              {platform.currentUrl && (
                <p className="truncate" title={platform.currentUrl}>
                  URL: <span className="font-medium text-gray-900 dark:text-white">
                    {new URL(platform.currentUrl).hostname}
                  </span>
                </p>
              )}
              {platform.error && (
                <p className="text-red-500 dark:text-red-400">
                  {platform.error}
                </p>
              )}
              <p>
                检查时间: {formatDateTime(platform.lastCheck)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {(!data?.platforms || Object.keys(data.platforms).length === 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 border border-gray-200 dark:border-slate-700 text-center">
          <div className="text-gray-400 dark:text-gray-500 text-lg mb-4">
            暂无平台状态数据
          </div>
          <button
            onClick={triggerCheck}
            disabled={checking}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            点击检查所有平台
          </button>
        </div>
      )}
    </div>
  );
}
