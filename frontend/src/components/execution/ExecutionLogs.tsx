import { useEffect, useRef } from 'react';
import { AlertCircle, Info, AlertTriangle } from 'lucide-react';
import type { LogEntry } from '../../hooks/useExecutionStatus';

interface ExecutionLogsProps {
  logs: LogEntry[];
  autoScroll?: boolean;
}

export function ExecutionLogs({ logs, autoScroll = true }: ExecutionLogsProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const getLogIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'info':
        return <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
    }
  };

  const getLogColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'info':
        return 'text-slate-300';
      case 'warning':
        return 'text-yellow-300';
      case 'error':
        return 'text-red-300';
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-center">
          <Info className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No logs yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 rounded-lg border border-slate-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Execution Logs</h3>
        <span className="text-xs text-slate-500">{logs.length} entries</span>
      </div>

      {/* Logs container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
        {logs.map((log, index) => (
          <div key={index} className="flex items-start gap-3 hover:bg-slate-800/50 p-2 rounded">
            {getLogIcon(log.level)}
            <span className="text-slate-500 flex-shrink-0">{formatTime(log.timestamp)}</span>
            <span className={`flex-1 ${getLogColor(log.level)}`}>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
