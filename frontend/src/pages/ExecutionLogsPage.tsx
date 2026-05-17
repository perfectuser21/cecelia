import { useState, useEffect, useRef } from 'react';
import { FileText, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Download, Search } from 'lucide-react';
import { brainApi, Task, TaskLogsResponse, TaskCheckpointsResponse } from '../api/brain.api';

const STATUS_COLORS = {
  queued: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', icon: Clock },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', icon: Loader2 },
  completed: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', icon: XCircle },
  cancelled: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', icon: XCircle },
};

const TASK_TYPES = [
  { value: '', label: '所有类型' },
  { value: 'dev', label: 'Dev' },
  { value: 'automation', label: 'Automation' },
  { value: 'qa', label: 'QA' },
  { value: 'audit', label: 'Audit' },
  { value: 'research', label: 'Research' },
];

const STATUSES = [
  { value: '', label: '所有状态' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export default function ExecutionLogsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLogsResponse | null>(null);
  const [checkpoints, setCheckpoints] = useState<TaskCheckpointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const response = await brainApi.getTasks({
        status: statusFilter || undefined,
        task_type: typeFilter || undefined,
        limit: 100,
      });
      setTasks(response.data);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskLogs = async (taskId: string) => {
    try {
      setLogsLoading(true);
      const [logsRes, checkpointsRes] = await Promise.all([
        brainApi.getTaskLogs(taskId),
        brainApi.getTaskCheckpoints(taskId),
      ]);
      setLogs(logsRes.data);
      setCheckpoints(checkpointsRes.data);
    } catch (error) {
      console.error('Failed to fetch task logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    if (selectedTask && selectedTask.status === 'running') {
      const interval = setInterval(() => fetchTaskLogs(selectedTask.id), 5000); // Refresh running task logs every 5 seconds
      return () => clearInterval(interval);
    }
  }, [selectedTask]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleTaskSelect = (task: Task) => {
    setSelectedTask(task);
    fetchTaskLogs(task.id);
  };

  const downloadLogs = () => {
    if (!logs || !logs.logs.length) return;

    const content = logs.logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-${logs.task_id}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs?.logs.filter(line =>
    searchTerm ? line.toLowerCase().includes(searchTerm.toLowerCase()) : true
  ) || [];

  const formatTimestamp = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4">
      {/* Left Panel - Task List */}
      <div className="w-96 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">任务列表</h2>
            <button
              onClick={fetchTasks}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TASK_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              暂无任务
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {tasks.map(task => {
                const statusConfig = STATUS_COLORS[task.status] || STATUS_COLORS.queued;
                const StatusIcon = statusConfig.icon;
                const isSelected = selectedTask?.id === task.id;

                return (
                  <button
                    key={task.id}
                    onClick={() => handleTaskSelect(task)}
                    className={`w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <StatusIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        task.status === 'running' ? 'animate-spin' : ''
                      } ${statusConfig.text}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {task.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded ${statusConfig.bg} ${statusConfig.text}`}>
                            {task.status}
                          </span>
                          {task.task_type && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {task.task_type}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatTimestamp(task.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Log Details */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {!selectedTask ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>选择一个任务查看日志</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedTask.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Task ID: {selectedTask.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded"
                    />
                    自动滚动
                  </label>
                  <button
                    onClick={downloadLogs}
                    disabled={!logs || logs.logs.length === 0}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    title="下载日志"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索日志..."
                  className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Checkpoints */}
              {checkpoints && checkpoints.checkpoints.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {checkpoints.checkpoints.map((cp, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                      title={formatTimestamp(cp.timestamp)}
                    >
                      {cp.event}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Logs Content */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
              {logsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : !logs || logs.logs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                  {logs?.message || '暂无日志'}
                </div>
              ) : (
                <div className="font-mono text-xs space-y-0.5">
                  {filteredLogs.map((line, idx) => (
                    <div
                      key={idx}
                      className="text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 px-2 py-0.5 rounded"
                    >
                      {line}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>

            {/* Footer Stats */}
            {logs && logs.total_lines !== undefined && (
              <div className="p-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 text-center">
                {filteredLogs.length} / {logs.total_lines} 行
                {searchTerm && ` (已过滤)`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
