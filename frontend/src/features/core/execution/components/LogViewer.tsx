import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import LogEntry, { type LogEntryData } from './LogEntry';
import LogFilter, { type LogFilterOptions } from './LogFilter';

interface LogViewerProps {
  runId?: string;
  autoScroll?: boolean;
}

export default function LogViewer({ runId, autoScroll = true }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntryData[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntryData[]>([]);
  const [filters, setFilters] = useState<LogFilterOptions>({
    levels: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    searchQuery: '',
  });
  const [isPaused, setIsPaused] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(autoScroll);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(isAutoScrollEnabled);
  const userScrolledRef = useRef(false);

  // Update autoScrollRef when isAutoScrollEnabled changes
  useEffect(() => {
    autoScrollRef.current = isAutoScrollEnabled;
  }, [isAutoScrollEnabled]);

  // Fetch logs
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;

    const fetchLogs = async () => {
      try {
        const url = runId
          ? `/api/cecelia/runs/${runId}/logs`
          : '/api/orchestrator/logs?lines=1000';
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
          // Parse logs from the response
          const newLogs = parseLogs(data.logs);
          setLogs(newLogs);
          setError(null);
        } else {
          setError(data.error || 'Failed to fetch logs');
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();

    // Poll for new logs every 2 seconds if not paused
    if (!isPaused) {
      pollInterval = setInterval(fetchLogs, 2000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [runId, isPaused]);

  // Parse logs from various formats
  const parseLogs = (logsData: any): LogEntryData[] => {
    const parsed: LogEntryData[] = [];

    if (typeof logsData === 'object' && !Array.isArray(logsData)) {
      // Object format: { 'file1': 'log content', 'file2': 'log content' }
      for (const [source, content] of Object.entries(logsData)) {
        if (typeof content === 'string') {
          const lines = content.split('\n').filter(line => line.trim());
          lines.forEach((line, index) => {
            parsed.push(parseLogLine(line, source, index));
          });
        }
      }
    } else if (Array.isArray(logsData)) {
      // Array format: [{ timestamp, level, source, message }, ...]
      logsData.forEach(log => {
        parsed.push({
          timestamp: log.timestamp || new Date().toISOString(),
          level: log.level || 'INFO',
          source: log.source || 'system',
          message: log.message || String(log),
        });
      });
    }

    return parsed;
  };

  // Parse a single log line
  const parseLogLine = (line: string, source: string, index: number): LogEntryData => {
    // Try to parse structured log: [timestamp] [level] message
    const structuredMatch = line.match(/^\[(.+?)\]\s*\[(\w+)\]\s*(.+)$/);
    if (structuredMatch) {
      return {
        timestamp: structuredMatch[1],
        level: (structuredMatch[2].toUpperCase() as LogEntryData['level']) || 'INFO',
        source,
        message: structuredMatch[3],
      };
    }

    // Try to detect level from content
    const levelMatch = line.match(/\b(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i);
    const level = levelMatch
      ? (levelMatch[1].toUpperCase() === 'WARNING' ? 'WARN' : levelMatch[1].toUpperCase() as LogEntryData['level'])
      : 'INFO';

    return {
      timestamp: new Date().toISOString(),
      level,
      source,
      message: line,
    };
  };

  // Filter logs
  useEffect(() => {
    let filtered = logs;

    // Filter by level
    filtered = filtered.filter(log => filters.levels.includes(log.level));

    // Filter by search query
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(
        log =>
          log.message.toLowerCase().includes(query) ||
          log.source.toLowerCase().includes(query)
      );
    }

    // Filter by time range
    if (filters.startTime) {
      const startTime = new Date(filters.startTime).getTime();
      filtered = filtered.filter(log => new Date(log.timestamp).getTime() >= startTime);
    }
    if (filters.endTime) {
      const endTime = new Date(filters.endTime).getTime();
      filtered = filtered.filter(log => new Date(log.timestamp).getTime() <= endTime);
    }

    setFilteredLogs(filtered);
  }, [logs, filters]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && !userScrolledRef.current && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [filteredLogs]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    userScrolledRef.current = !isAtBottom;
    if (isAtBottom) {
      setIsAutoScrollEnabled(true);
    }
  }, []);

  // Export logs
  const exportLogs = () => {
    const content = filteredLogs
      .map(log => `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${runId || 'all'}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    setFilteredLogs([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">加载日志中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-red-600 dark:text-red-400">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800">
      {/* Filters */}
      <LogFilter filters={filters} onFilterChange={setFilters} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span>
            显示 {filteredLogs.length} / {logs.length} 条日志
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-scroll Toggle */}
          <button
            onClick={() => setIsAutoScrollEnabled(!isAutoScrollEnabled)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
              isAutoScrollEnabled
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-slate-600'
            }`}
          >
            {isAutoScrollEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isAutoScrollEnabled ? '自动滚动' : '已暂停'}
          </button>

          {/* Pause/Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="px-3 py-1.5 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {isPaused ? '恢复' : '暂停'}
          </button>

          {/* Clear */}
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            清空
          </button>

          {/* Export */}
          <button
            onClick={exportLogs}
            className="px-3 py-1.5 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            导出
          </button>
        </div>
      </div>

      {/* Logs Container */}
      <div
        ref={logsContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        style={{ height: 'calc(100vh - 280px)' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p>暂无日志</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filteredLogs.map((log, index) => (
              <LogEntry key={index} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
