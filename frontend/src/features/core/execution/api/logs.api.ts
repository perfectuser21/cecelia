// Logs API client - 执行日志

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface LogsResponse {
  success: boolean;
  logs: Record<string, string>; // key: log file stem, value: log content
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN' | 'UNKNOWN';
  source: string; // log file name
  message: string;
  raw: string; // original line
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const logsApi = {
  // 获取执行日志
  getLogs: (lines: number = 50): Promise<LogsResponse> => {
    return fetchApi(`/api/v1/orchestrator/logs?lines=${lines}`);
  },
};

// 解析日志行
export function parseLogLine(line: string, source: string): LogEntry {
  // 尝试解析时间戳 (ISO 8601 or common formats)
  const timestampRegex = /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?)/;
  const timestampMatch = line.match(timestampRegex);
  
  let timestamp = '';
  let rest = line;
  
  if (timestampMatch) {
    timestamp = timestampMatch[1];
    rest = line.slice(timestamp.length).trim();
  }
  
  // 解析日志级别
  const levelRegex = /^\[?(INFO|ERROR|DEBUG|WARN|CRITICAL|WARNING)\]?:?\s*/i;
  const levelMatch = rest.match(levelRegex);
  
  let level: LogEntry['level'] = 'UNKNOWN';
  let message = rest;
  
  if (levelMatch) {
    const levelStr = levelMatch[1].toUpperCase();
    level = ['INFO', 'ERROR', 'DEBUG', 'WARN'].includes(levelStr) 
      ? levelStr as LogEntry['level']
      : 'UNKNOWN';
    message = rest.slice(levelMatch[0].length);
  }
  
  // 如果没有时间戳，使用当前时间
  if (!timestamp) {
    timestamp = new Date().toISOString();
  }
  
  return {
    timestamp,
    level,
    source,
    message: message || line,
    raw: line,
  };
}

// 将 logs 对象转换为 LogEntry 数组
export function convertLogsToEntries(logs: Record<string, string>): LogEntry[] {
  const entries: LogEntry[] = [];
  
  for (const [source, content] of Object.entries(logs)) {
    const lines = content.split('\n').filter(line => line.trim());
    for (const line of lines) {
      entries.push(parseLogLine(line, source));
    }
  }
  
  // 按时间戳排序 (最新的在前)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return entries;
}
