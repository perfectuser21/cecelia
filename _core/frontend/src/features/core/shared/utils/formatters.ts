/**
 * Shared formatting utilities
 * Replaces 20+ duplicate formatting functions across the codebase
 */

/**
 * Format date/time with various options
 * @param date - Date string, timestamp, or Date object
 * @param options - Formatting options
 */
export function formatDateTime(
  date: string | number | Date,
  options: {
    dateStyle?: 'full' | 'long' | 'medium' | 'short';
    timeStyle?: 'full' | 'long' | 'medium' | 'short';
    locale?: string;
  } = {}
): string {
  const { dateStyle, timeStyle, locale = 'zh-CN' } = options;
  const d = new Date(date);

  if (isNaN(d.getTime())) {
    return '-';
  }

  // Default to short date + time if no style specified
  if (!dateStyle && !timeStyle) {
    return d.toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return d.toLocaleString(locale, {
    ...(dateStyle && { dateStyle }),
    ...(timeStyle && { timeStyle }),
  });
}

/**
 * Format time only (HH:mm or HH:mm:ss)
 */
export function formatTimeOnly(
  date: string | number | Date,
  includeSeconds = false,
  locale = 'zh-CN'
): string {
  const d = new Date(date);

  if (isNaN(d.getTime())) {
    return '--:--';
  }

  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds && { second: '2-digit' }),
  });
}

/**
 * Format duration from milliseconds
 * @param ms - Duration in milliseconds
 * @param options - Formatting options
 */
export function formatDuration(
  ms: number,
  options: {
    showSeconds?: boolean;
    compact?: boolean;
  } = {}
): string {
  const { showSeconds = true, compact = false } = options;

  if (ms < 0 || isNaN(ms)) {
    return '-';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (compact) {
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${showSeconds ? `${seconds % 60}s` : ''}`.trim();
    return showSeconds ? `${seconds}s` : '<1m';
  }

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours % 24 > 0) parts.push(`${hours % 24}小时`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}分钟`);
  if (showSeconds && seconds % 60 > 0 && days === 0) parts.push(`${seconds % 60}秒`);

  return parts.length > 0 ? parts.join(' ') : (showSeconds ? '0秒' : '<1分钟');
}

/**
 * Format duration from seconds (for uptime)
 */
export function formatUptime(seconds: number): string {
  if (seconds < 0 || isNaN(seconds)) {
    return '-';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

/**
 * Format relative time (e.g., "5分钟前", "刚刚")
 */
export function formatRelativeTime(date: string | number | Date): string {
  const d = new Date(date);

  if (isNaN(d.getTime())) {
    return '-';
  }

  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0 || isNaN(bytes)) return '-';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

/**
 * Format token count (for AI models)
 */
export function formatTokens(tokens: number): string {
  if (tokens < 0 || isNaN(tokens)) return '-';
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

/**
 * Format number with locale
 */
export function formatNumber(n: number, locale = 'zh-CN'): string {
  if (isNaN(n)) return '-';
  return n.toLocaleString(locale);
}
