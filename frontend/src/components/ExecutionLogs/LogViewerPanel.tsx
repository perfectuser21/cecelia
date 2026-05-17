import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Download, PlayCircle, PauseCircle } from 'lucide-react';

interface LogViewerPanelProps {
  logs: string[];
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  searchText?: string;
}

export const LogViewerPanel: React.FC<LogViewerPanelProps> = ({
  logs,
  runId,
  status,
  searchText = ''
}) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cecelia-logs-${runId}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLogLevel = (log: string): string => {
    const lower = log.toLowerCase();
    if (lower.includes('error') || lower.includes('❌') || lower.includes('failed'))
      return 'error';
    if (lower.includes('warn') || lower.includes('⚠️') || lower.includes('warning'))
      return 'warn';
    if (lower.includes('success') || lower.includes('✅') || lower.includes('completed'))
      return 'success';
    if (lower.includes('info') || lower.includes('ℹ️'))
      return 'info';
    return 'default';
  };

  const getLogClassName = (level: string): string => {
    const baseClass = 'py-1 px-2 rounded font-mono text-sm';
    switch (level) {
      case 'error':
        return `${baseClass} text-red-400 bg-red-900/20`;
      case 'warn':
        return `${baseClass} text-yellow-400 bg-yellow-900/20`;
      case 'success':
        return `${baseClass} text-green-400 bg-green-900/20`;
      case 'info':
        return `${baseClass} text-blue-400 bg-blue-900/20`;
      default:
        return `${baseClass} text-gray-300`;
    }
  };

  // Filter logs by search text
  const filteredLogs = searchText
    ? logs.filter(log => log.toLowerCase().includes(searchText.toLowerCase()))
    : logs;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">执行日志</h3>
            <span className="text-sm text-gray-500">({filteredLogs.length} 行)</span>
            {status === 'running' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                运行中
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-2 rounded-lg transition-colors ${
                autoScroll
                  ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                  : 'hover:bg-gray-200 text-gray-600'
              }`}
              title={autoScroll ? '禁用自动滚动' : '启用自动滚动'}
            >
              {autoScroll ? (
                <PauseCircle className="w-4 h-4" />
              ) : (
                <PlayCircle className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleDownload}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="下载日志"
            >
              <Download className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* Logs Content */}
      <div className="flex-1 overflow-auto bg-gray-900 p-4">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchText ? '没有匹配的日志' : '暂无日志'}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log, index) => {
              const level = getLogLevel(log);
              return (
                <div key={index} className={getLogClassName(level)}>
                  <span className="text-gray-500 mr-3">
                    {String(index + 1).padStart(4, '0')}
                  </span>
                  {log}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
