import { useState, useEffect, useRef } from 'react';
import { Search, Filter, Download, RefreshCw, Eye, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface ExecutionLog {
  id: string;
  title: string;
  status: string;
  task_type: string;
  priority: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  project_name?: string;
  payload?: {
    log_file?: string;
    run_status?: string;
  };
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface FilterState {
  status: string;
  task_type: string;
  start_date: string;
  end_date: string;
  search: string;
}

const STATUS_COLORS: Record<string, string> = {
  'pending': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'in_progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'completed': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'failed': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  'cancelled': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'pending': Clock,
  'in_progress': Loader2,
  'completed': CheckCircle2,
  'failed': XCircle,
  'cancelled': XCircle,
};

function formatTimestamp(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function calculateDuration(startDate: string, endDate?: string) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return `${diffSecs}s`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  return `${diffHours}h ${diffMins % 60}m`;
}

export default function ExecutionLogs() {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: 100, offset: 0, has_more: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLog, setSelectedLog] = useState<ExecutionLog | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    status: '',
    task_type: '',
    start_date: '',
    end_date: '',
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', String(pagination.limit));
      params.append('offset', String(pagination.offset));

      if (filters.status) params.append('status', filters.status);
      if (filters.task_type) params.append('task_type', filters.task_type);
      if (filters.start_date) params.append('start_date', filters.start_date);
      if (filters.end_date) params.append('end_date', filters.end_date);
      if (filters.search) params.append('search', filters.search);

      const res = await fetch(`/api/brain/execution-logs?${params.toString()}`);
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      setLogs(data.logs);
      setPagination(data.pagination);
      setError('');
    } catch (err) {
      setError('Failed to load execution logs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogDetail = async (logId: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/brain/execution-logs/${logId}`);
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      setLogContent(data.log_content);
    } catch (err) {
      console.error(err);
      setLogContent(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleViewLog = (log: ExecutionLog) => {
    setSelectedLog(log);
    fetchLogDetail(log.id);
  };

  const handleDownloadLog = async (log: ExecutionLog) => {
    try {
      const res = await fetch(`/api/brain/execution-logs/${log.id}`);
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      if (data.log_content) {
        const blob = new Blob([data.log_content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `execution-log-${log.id}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters({
      status: '',
      task_type: '',
      start_date: '',
      end_date: '',
      search: '',
    });
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [filters, pagination.offset]);

  const StatusIcon = ({ status }: { status: string }) => {
    const Icon = STATUS_ICONS[status] || Clock;
    return <Icon className={`w-4 h-4 ${status === 'in_progress' ? 'animate-spin' : ''}`} />;
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Execution Logs</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          View and filter task execution logs
        </p>
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex items-center gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search logs..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
          />
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>

        {/* Refresh */}
        <button
          onClick={fetchLogs}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Task Type</label>
              <select
                value={filters.task_type}
                onChange={(e) => handleFilterChange('task_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              >
                <option value="">All</option>
                <option value="dev">Development</option>
                <option value="automation">Automation</option>
                <option value="qa">QA</option>
                <option value="audit">Audit</option>
                <option value="research">Research</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => handleFilterChange('start_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => handleFilterChange('end_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Reset Filters
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 border border-red-300 dark:border-red-600 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Logs Table */}
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Title</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Project</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Duration</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Started</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No execution logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[log.status] || STATUS_COLORS.pending}`}>
                        <StatusIcon status={log.status} />
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">
                      {log.title}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {log.task_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {log.project_name || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {calculateDuration(log.created_at, log.completed_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewLog(log)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          title="View log"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDownloadLog(log)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          title="Download log"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total > 0 && (
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-600 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total} logs
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                disabled={pagination.offset === 0}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                disabled={!pagination.has_more}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-300 dark:border-gray-600 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {selectedLog.title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  ID: {selectedLog.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : logContent ? (
                <pre className="text-xs font-mono bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {logContent}
                </pre>
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  No log content available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
