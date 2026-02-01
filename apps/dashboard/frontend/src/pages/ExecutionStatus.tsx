import { useState, useEffect, useCallback } from 'react';
import { XCircle, Loader2, RefreshCw, TrendingUp, Zap, Activity, Play, Pause, AlertTriangle } from 'lucide-react';

// Brain API 类型定义
interface BrainStatus {
  enabled: boolean;
  loop_running: boolean;
  loop_interval_ms: number;
  last_tick: string | null;
  next_tick: string | null;
  actions_today: number;
  max_concurrent: number;
  circuit_breakers: {
    [key: string]: {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failure_count: number;
      last_failure_time: string | null;
    };
  };
}

interface Task {
  id: string;
  title: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  started_at?: string;
  created_at: string;
}

// 环境感知的 Brain API URL
const BRAIN_API_URL = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `${window.location.protocol}//${window.location.hostname}:5221`
  : 'http://localhost:5221';

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function ExecutionStatus() {
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Brain API
      try {
        const brainRes = await fetch(`${BRAIN_API_URL}/api/brain/tick/status`);
        if (brainRes.ok) {
          const brainData = await brainRes.json();
          setBrainStatus(brainData);
        }
      } catch (err) {
        console.warn('Brain API failed:', err);
        setBrainStatus(null);
      }

      // Tasks API
      try {
        const tasksRes = await fetch('/api/tasks/tasks');
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          setTasks(tasksData);
        }
      } catch (err) {
        console.warn('Tasks API failed:', err);
        setTasks([]);
      }

      setError('');
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const t = setInterval(loadData, 30000);
    return () => clearInterval(t);
  }, [loadData]);


  if (loading && !brainStatus) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Cecelia 运行监控</h1>
          <p className="text-sm text-gray-500 mt-1">实时监控 Brain 状态、任务队列和系统健康</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{lastUpdate} 更新</span>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Cecelia 运行时监控 */}
      {brainStatus && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Cecelia 运行时监控
            </h2>
          </div>

          {/* Seats + Tick Loop + Circuit Breaker + Task Queue */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* 1. Seats 配置 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                <Zap className="w-3.5 h-3.5" />
                <span>Seats 配置</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">最大并发</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{brainStatus.max_concurrent}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">使用中</span>
                  <span className="font-semibold text-blue-600">{tasks.filter(t => t.status === 'in_progress').length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">可用</span>
                  <span className="font-semibold text-green-600">
                    {brainStatus.max_concurrent - tasks.filter(t => t.status === 'in_progress').length}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                      style={{
                        width: `${brainStatus.max_concurrent > 0
                          ? (tasks.filter(t => t.status === 'in_progress').length / brainStatus.max_concurrent) * 100
                          : 0}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Tick Loop 状态 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                {brainStatus.enabled && brainStatus.loop_running ? (
                  <Play className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Pause className="w-3.5 h-3.5 text-gray-400" />
                )}
                <span>Tick Loop</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                  brainStatus.enabled && brainStatus.loop_running
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {brainStatus.enabled && brainStatus.loop_running ? '运行中' : '已停止'}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">间隔</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {brainStatus.loop_interval_ms / 60000}min
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">今日动作</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{brainStatus.actions_today}</span>
                </div>
                {brainStatus.last_tick && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">上次</span>
                    <span className="text-xs text-gray-500">{formatTime(brainStatus.last_tick)}</span>
                  </div>
                )}
                {brainStatus.next_tick && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">下次</span>
                    <span className="text-xs text-gray-500">{formatTime(brainStatus.next_tick)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 3. 熔断器状态 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>熔断器状态</span>
              </div>
              <div className="space-y-2">
                {Object.entries(brainStatus.circuit_breakers).map(([name, breaker]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 truncate">{name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        breaker.state === 'CLOSED'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : breaker.state === 'OPEN'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                      }`}>
                        {breaker.state}
                      </span>
                      {breaker.failure_count > 0 && (
                        <span className="text-xs text-gray-500">({breaker.failure_count})</span>
                      )}
                    </div>
                  </div>
                ))}
                {Object.keys(brainStatus.circuit_breakers).length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-2">无熔断器</div>
                )}
              </div>
            </div>

            {/* 4. 任务队列统计 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>任务队列</span>
              </div>
              <div className="space-y-2">
                {(['queued', 'in_progress', 'completed', 'failed', 'cancelled'] as const).map(status => {
                  const count = tasks.filter(t => t.status === status).length;
                  const percentage = tasks.length > 0 ? Math.round((count / tasks.length) * 100) : 0;
                  const colors = {
                    queued: 'text-gray-600',
                    in_progress: 'text-blue-600',
                    completed: 'text-green-600',
                    failed: 'text-red-600',
                    cancelled: 'text-gray-400'
                  };
                  const labels = {
                    queued: '队列中',
                    in_progress: '进行中',
                    completed: '已完成',
                    failed: '失败',
                    cancelled: '已取消'
                  };

                  return (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">{labels[status]}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${colors[status]}`}>{count}</span>
                        <span className="text-xs text-gray-400 w-10 text-right">{percentage}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5. 当前活动 */}
          {tasks.filter(t => t.status === 'in_progress').length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-4">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="font-medium text-gray-900 dark:text-white">当前活动</span>
                <span className="text-xs text-gray-400">
                  ({tasks.filter(t => t.status === 'in_progress').length} 个任务运行中)
                </span>
              </div>
              <div className="space-y-2">
                {tasks
                  .filter(t => t.status === 'in_progress')
                  .map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{task.title}</span>
                      </div>
                      {task.started_at && (
                        <span className="text-xs text-gray-500">
                          开始于 {formatTime(task.started_at)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
