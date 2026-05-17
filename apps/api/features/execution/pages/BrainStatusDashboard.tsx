import { Brain, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import BrainCoreStatus from '../components/BrainCoreStatus';
import BrainOKRProgress from '../components/BrainOKRProgress';
import BrainTaskQueue from '../components/BrainTaskQueue';

export default function BrainStatusDashboard() {
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // 手动刷新（组件会自动轮询，这里只是更新刷新时间显示）
  const handleRefresh = () => {
    setLastRefresh(new Date());
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                <Brain className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Brain Status Dashboard</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Cecelia Brain 实时状态监控
                </p>
              </div>
            </div>

            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 自动刷新提示 */}
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            ⏱️ 自动刷新间隔: 5 秒 | 上次刷新: {lastRefresh.toLocaleTimeString('zh-CN')}
          </p>
        </div>

        {/* 三栏布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 核心状态 */}
          <div>
            <BrainCoreStatus />
          </div>

          {/* OKR 进度 */}
          <div>
            <BrainOKRProgress />
          </div>

          {/* 任务队列 */}
          <div>
            <BrainTaskQueue />
          </div>
        </div>
      </div>
    </div>
  );
}
