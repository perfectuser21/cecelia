/**
 * relay-smoke.js — headed relay 链冒烟纯函数（零生产接线）
 *
 * 确定性冒烟戳：formatSmokeStamp(taskId, date) -> `smoke:<taskId 前 8 位>:<YYYYMMDD>`
 * - 日期语义锁定 UTC（getUTC* 系列），同输入跨进程/跨时区必得同输出
 * - 非法输入抛 TypeError（不静默返回占位串）
 * - 无 I/O、无全局可变状态、不 import 任何其他模块
 */

/**
 * 生成确定性冒烟戳。
 * @param {string} taskId 任务 UUID 字符串（非空）；不足 8 位时使用完整 taskId
 * @param {Date} date 合法 Date 对象（按 UTC 取 YYYYMMDD）
 * @returns {string} `smoke:<taskId 前 8 位>:<YYYYMMDD>`
 * @throws {TypeError} taskId 为空/非字符串，或 date 非 Date/Invalid Date
 */
export function formatSmokeStamp(taskId, date) {
  if (typeof taskId !== 'string' || taskId === '') {
    throw new TypeError('taskId must be a non-empty string');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `smoke:${taskId.slice(0, 8)}:${yyyy}${mm}${dd}`;
}
