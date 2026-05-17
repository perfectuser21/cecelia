/**
 * format-bytes.js - 字节数格式化工具
 *
 * 将字节数转换为人类可读的字符串（B / KB / MB / GB）。
 * 轻量纯函数，无外部依赖，供 watchdog / stats / health-monitor 等模块共用。
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * 将字节数格式化为人类可读字符串
 * @param {number} bytes - 字节数（非负整数）
 * @param {number} [decimals=1] - 保留小数位数
 * @returns {string} 格式化后的字符串，如 "1.5 MB"
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes < 0) throw new RangeError('bytes must be non-negative');
  if (bytes === 0) return '0 B';

  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), UNITS.length - 1);
  const value = bytes / Math.pow(k, i);

  return `${parseFloat(value.toFixed(decimals))} ${UNITS[i]}`;
}
