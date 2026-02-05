import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, CheckCircle2, Info, AlertTriangle, XCircle } from 'lucide-react';
import { logsApi, convertLogsToEntries, type LogEntry } from '../api/logs.api';

const LINE_OPTIONS = [50, 100, 200, 500];
const REFRESH_INTERVALS = [
  { label: 'sí', value: 0 },
  { label: '5Ò', value: 5000 },
  { label: '10Ò', value: 10000 },
  { label: '30Ò', value: 30000 },
];

export default function ExecutionLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLines, setSelectedLines] = useState(100);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [lastUpdate, setLastUpdate] = useState('');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await logsApi.getLogs(selectedLines);
      const entries = convertLogsToEntries(response.logs);
      setLogs(entries);
      setError('');
      setLastUpdate(new Date().toLocaleTimeString('zh-CN'));
    } catch (err) {
      setError(err instanceof Error ? err.message : ' }1%');
    } finally {
      setLoading(false);
    }
  }, [selectedLines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto refresh
  useEffect(() => {
    if (refreshInterval === 0) return;

    const timer = setInterval(fetchLogs, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, fetchLogs]);

  // Filter logs by search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;

    const query = searchQuery.toLowerCase();
    return logs.filter(log =>
      log.message.toLowerCase().includes(query) ||
      log.source.toLowerCase().includes(query) ||
      log.level.toLowerCase().includes(query)
    );
  }, [logs, searchQuery]);

  const getLevelIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'ERROR':
        return <XCircle className="w-4 h-4" />;
      case 'WARN':
        return <AlertTriangle className="w-4 h-4" />;
      case 'INFO':
        return <Info className="w-4 h-4" />;
      case 'DEBUG':
        return <CheckCircle2 className="w-4 h-4" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'ERROR':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      case 'WARN':
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20';
      case 'INFO':
        return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
      case 'DEBUG':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">gLå×</h1>
        <p className="text-sm text-gray-500 mt-1">žöåûßgLå×</p>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder=""å×..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Lines selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Lp:</span>
            <select
              value={selectedLines}
              onChange={(e) => setSelectedLines(Number(e.target.value))}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            >
              {LINE_OPTIONS.map(lines => (
                <option key={lines} value={lines}>{lines}</option>
              ))}
            </select>
          </div>

          {/* Refresh interval */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">7°:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            >
              {REFRESH_INTERVALS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {/* Manual refresh button */}
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="K¨7°"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Last update time */}
          {lastUpdate && (
            <span className="text-xs text-gray-400">
              ô°Ž {lastUpdate}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            ;¡: <span className="font-medium text-gray-900 dark:text-white">{logs.length}</span>
          </span>
          {searchQuery && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              9M: <span className="font-medium text-gray-900 dark:text-white">{filteredLogs.length}</span>
            </span>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-2 text-red-700 dark:text-red-400 mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && logs.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      {/* Logs list */}
      {!loading && filteredLogs.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center text-gray-400 border border-gray-100 dark:border-gray-700">
          {searchQuery ? '¡	9M„å×' : '‚àå×pn'}
        </div>
      )}

      {filteredLogs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log, index) => (
              <div
                key={index}
                className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors font-mono text-xs"
              >
                <div className="flex items-start gap-3">
                  {/* Level badge */}
                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${getLevelColor(log.level)} flex-shrink-0`}>
                    {getLevelIcon(log.level)}
                    <span className="font-medium">{log.level}</span>
                  </div>

                  {/* Source */}
                  <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                    [{log.source}]
                  </span>

                  {/* Timestamp */}
                  <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString('zh-CN')}
                  </span>

                  {/* Message */}
                  <span className="text-gray-900 dark:text-gray-100 flex-1 break-all">
                    {log.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
