import { AlertCircle, Info, AlertTriangle, Bug } from 'lucide-react';

export interface LogEntryData {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
}

interface LogEntryProps {
  log: LogEntryData;
}

const LEVEL_CONFIG = {
  DEBUG: {
    icon: Bug,
    color: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-50 dark:bg-gray-900/50',
    border: 'border-gray-200 dark:border-gray-700',
  },
  INFO: {
    icon: Info,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
  },
  WARN: {
    icon: AlertTriangle,
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  ERROR: {
    icon: AlertCircle,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
  },
};

export default function LogEntry({ log }: LogEntryProps) {
  const config = LEVEL_CONFIG[log.level];
  const Icon = config.icon;

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className={`flex items-start gap-3 px-4 py-2 border-l-2 ${config.border} ${config.bg} hover:bg-opacity-80 transition-colors`}>
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
      <div className="flex-1 min-w-0 font-mono text-sm">
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span className="font-semibold">{formatTime(log.timestamp)}</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${config.color} ${config.bg} border ${config.border}`}>
            {log.level}
          </span>
          <span className="text-gray-600 dark:text-gray-300">{log.source}</span>
        </div>
        <div className="text-gray-900 dark:text-gray-100 break-words whitespace-pre-wrap">
          {log.message}
        </div>
      </div>
    </div>
  );
}
