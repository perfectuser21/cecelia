/**
 * resource-monitor.js
 *
 * 统一资源状态接口，供 slot-allocator 和 circuit-breaker 调用。
 * 读取 os.loadavg 和 process.memoryUsage，返回当前系统资源压力状态。
 */

import os from 'os';

let CPU_THRESHOLD = 2.0;
let MEM_THRESHOLD = 0.85;

/**
 * 获取当前系统资源压力状态（同步）
 * @returns {{ cpu_load_1m: number, memory_pct: number, cpu_throttle: boolean, memory_throttle: boolean, any_throttle: boolean }}
 */
export function getResourcePressure() {
  const cpu_load_1m = os.loadavg()[0];
  const { heapUsed, heapTotal } = process.memoryUsage();
  const memory_pct = heapUsed / heapTotal;

  const cpu_throttle = cpu_load_1m > CPU_THRESHOLD;
  const memory_throttle = memory_pct > MEM_THRESHOLD;
  const any_throttle = cpu_throttle || memory_throttle;

  return { cpu_load_1m, memory_pct, cpu_throttle, memory_throttle, any_throttle };
}

/**
 * 重置阈值（仅用于测试）
 * @param {number} cpu - CPU load 阈值
 * @param {number} mem - 内存占比阈值
 */
export function resetThresholds(cpu = 2.0, mem = 0.85) {
  CPU_THRESHOLD = cpu;
  MEM_THRESHOLD = mem;
}
