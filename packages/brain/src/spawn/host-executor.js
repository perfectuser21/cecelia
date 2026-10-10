/**
 * host-executor.js — mac_web 环境专用：原在宿主 Mac 上运行 Claude Code
 *
 * 原实现：Brain 在容器内时 ssh 逃逸到宿主跑 scripts/ 下的 claude 启动器（-p 读 stdin），
 * 裸机时直接本机 spawn claude。它的唯一用途就是拉起 claude。
 *
 * Claude 无头通道已退役（任务 76a160b3，决策 067867c8，单一来源 lib/claude-channel.js）：
 * executeOnHost 一律抛 ClaudeChannelRetiredError，不写 prompt、不发起 SSH、不启动任何进程。
 */

import { ClaudeChannelRetiredError } from '../lib/claude-channel.js';

/**
 * @param {object} opts
 * @param {object} opts.task  { id }
 * @returns {Promise<never>}
 */
export async function executeOnHost(opts) {
  throw new ClaudeChannelRetiredError(`host-executor task=${opts?.task?.id ?? 'unknown'}`);
}
