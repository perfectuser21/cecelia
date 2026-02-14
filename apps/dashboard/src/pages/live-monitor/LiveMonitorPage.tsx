/**
 * LiveMonitorPage - Cecelia Live Monitor Dashboard
 *
 * 实时监控 Cecelia Brain 的工作状态
 * 布局：类 tmux 四分屏（Brain Status / Resources / Active Tasks / Live Logs）
 */

import { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Pause,
  Trash2,
  RefreshCw,
} from 'lucide-react';

// ============ Mock Data ============
const mockBrainStatus = {
  running: true,
  tick_number: 1234,
  alertness: { level: 1, name: 'NORMAL' },
  uptime_seconds: 12345,
};

const mockResources = {
  cpu_percent: 45,
  memory_percent: 60,
  disk_percent: 25,
  task_counts: {
    active: 2,
    queued: 5,
  },
};

const mockActiveTasks = [
  {
    id: '50',
    title: '修复 embeddings 重试',
    status: 'in_progress',
    progress: 80,
    started_at: new Date().toISOString(),
    elapsed_seconds: 765,
  },
  {
    id: '51',
    title: '熔断机制增强',
    status: 'pending',
    progress: 0,
    blocked_by: ['50'],
  },
];

const mockLogs = [
  { timestamp: new Date(), source: 'tick-loop', message: 'Tick #1234 completed', level: 'info' },
  { timestamp: new Date(), source: 'executor', message: 'Dispatched task #50', level: 'info' },
  { timestamp: new Date(), source: 'Monitor', message: 'CPU: 45%, Memory: 60%', level: 'info' },
];

// ============ Helper Functions ============
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function getProgressColor(percent: number): string {
  if (percent < 60) return 'bg-green-500';
  if (percent < 80) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ============ Components ============

function BrainStatusCard() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-blue-500" />
        <h3 className="font-semibold text-slate-800 dark:text-white">Brain Status</h3>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${mockBrainStatus.running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {mockBrainStatus.running ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="text-sm text-slate-600 dark:text-slate-400">
          <div>Tick: #{mockBrainStatus.tick_number}</div>
          <div>Alertness: {mockBrainStatus.alertness.name}</div>
          <div>Uptime: {formatUptime(mockBrainStatus.uptime_seconds)}</div>
        </div>
      </div>
    </div>
  );
}

function ResourcesCard() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-3 mb-4">
        <Cpu className="w-5 h-5 text-blue-500" />
        <h3 className="font-semibold text-slate-800 dark:text-white">System Resources</h3>
      </div>

      <div className="space-y-4">
        {/* CPU */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-slate-600 dark:text-slate-400">CPU</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{mockResources.cpu_percent}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getProgressColor(mockResources.cpu_percent)}`}
              style={{ width: `${mockResources.cpu_percent}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-slate-600 dark:text-slate-400">Memory</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{mockResources.memory_percent}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getProgressColor(mockResources.memory_percent)}`}
              style={{ width: `${mockResources.memory_percent}%` }}
            />
          </div>
        </div>

        {/* Disk */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-slate-600 dark:text-slate-400">Disk</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{mockResources.disk_percent}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getProgressColor(mockResources.disk_percent)}`}
              style={{ width: `${mockResources.disk_percent}%` }}
            />
          </div>
        </div>

        {/* Task Counts */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-400">Active Tasks</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{mockResources.task_counts.active}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-slate-600 dark:text-slate-400">Queued</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{mockResources.task_counts.queued}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveTasksList() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <h3 className="font-semibold text-slate-800 dark:text-white mb-4">📋 Active Tasks</h3>

      <div className="space-y-4">
        {mockActiveTasks.map(task => (
          <div key={task.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="font-medium text-slate-800 dark:text-white">#{task.id} {task.title}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {task.status === 'in_progress' && task.started_at && (
                    <span>Started: {new Date(task.started_at).toLocaleTimeString()} • Running: {Math.floor(task.elapsed_seconds / 60)}m</span>
                  )}
                  {task.status === 'pending' && task.blocked_by && (
                    <span>Blocked by: #{task.blocked_by.join(', #')}</span>
                  )}
                </div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                task.status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {task.status}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{task.progress}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveLogsPanel() {
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState(mockLogs);

  const handleClear = () => {
    setLogs([]);
  };

  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      'tick-loop': 'text-blue-500',
      'executor': 'text-green-500',
      'Monitor': 'text-yellow-500',
      'task': 'text-purple-500',
      'alertness': 'text-red-500',
    };
    return colors[source] || 'text-slate-500';
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800 dark:text-white">📜 Live Logs</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title={isPaused ? 'Resume' : 'Pause'}
          >
            <Pause className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          </button>
          <button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Clear"
          >
            <Trash2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          </button>
        </div>
      </div>

      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
        {logs.map((log, i) => (
          <div key={i} className="mb-1 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1 rounded cursor-pointer">
            <span className="text-slate-400 dark:text-slate-600 mr-2">
              {log.timestamp.toLocaleTimeString()}
            </span>
            <span className={`mr-2 ${getSourceColor(log.source)}`}>[{log.source}]</span>
            <span className="text-slate-700 dark:text-slate-300">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ Main Page ============

export default function LiveMonitorPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
            🧠 Cecelia Live Monitor
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            实时监控 Brain 状态、资源使用和任务执行
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* 四分屏布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左上: Brain Status */}
        <BrainStatusCard />

        {/* 右上: System Resources */}
        <ResourcesCard />

        {/* 左下: Active Tasks */}
        <ActiveTasksList />

        {/* 右下: Live Logs */}
        <LiveLogsPanel />
      </div>

      {/* 提示信息 */}
      <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          ⚠️  当前使用 Mock 数据展示。待 Brain API 完成后将连接实时数据源（WebSocket: ws://localhost:5221/ws）
        </p>
      </div>
    </div>
  );
}
