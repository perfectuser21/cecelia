/**
 * 将毫秒数格式化为人类可读的时长字符串
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return sec > 0 ? `${min}m${sec}s` : `${min}m`;
}
