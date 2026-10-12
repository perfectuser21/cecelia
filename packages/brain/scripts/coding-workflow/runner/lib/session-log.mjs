// runner 主日志降噪（C1 runner-log-noise）：runner 进程内的 claude 会话（ci-fix/qa-fix/commander）输出只落
// <logDir>[/<仓库命名空间>]/<kind>-<pr>-<后缀>.log（保留期清理照常覆盖），主日志只留一行摘要；空闲日志限频。
import fs from 'node:fs';
import path from 'node:path';
import { prFile } from './repos.mjs';

const EXCERPT_MAX = 80;

/** 会话文件路径：沿用既有命名 cifix-<pr>-<ts>.log / qa-fix-<pr>-<ts>.log / commander-<pr>-<n>.log。 */
export function sessionLogPath(cfg, kind, pr, suffix) {
  return prFile(cfg, `${kind}-${pr}-${suffix}.log`);
}

/** stdout 里最后一个 result 事件（--output-format json/stream-json）；没有或解析失败返回 null。 */
function lastResultEvent(stdout) {
  const lines = String(stdout ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'result') return event;
    } catch { /* 不是完整 JSON，继续往前找 */ }
  }
  return null;
}

function excerptOf(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

/** 主日志一行摘要：会话 <tag> PR #<pr> 结束：exit、轮数、时长、花费、结论摘录 → 会话文件。 */
export function sessionSummary(tag, pr, run) {
  const parts = [`exit ${run.code ?? '无'}`];
  if (run.timedOut) parts.push('超时');
  if (run.terminated) parts.push('被终止');
  const event = lastResultEvent(run.stdout);
  if (event?.is_error) parts.push(`会话报错 ${event.subtype ?? ''}`.trim());
  if (Number.isFinite(event?.num_turns)) parts.push(`${event.num_turns} 轮`);
  if (Number.isFinite(event?.duration_ms)) parts.push(`${Math.round(event.duration_ms / 1000)}s`);
  if (typeof run.cost_usd === 'number') parts.push(`$${run.cost_usd}`);
  const excerpt = typeof event?.result === 'string' && event.result.trim() ? `，「${excerptOf(event.result)}」` : '';
  const target = run.transcriptPath ? `${excerpt ? '' : ' '}→ ${run.transcriptPath}` : '';
  return `会话 ${tag} PR #${pr} 结束：${parts.join('，')}${excerpt}${target}`;
}

/**
 * 空闲日志「没有可新跑的开关任务」是否该打：距上次打超过 cfg.idleLogIntervalMs（0 = 每次都打）才打，并记下这次时间。
 * 时间戳记在 <logDir>/idle-log.stamp（不是 .log/.json，保留期清理不碰）；读写失败一律当该打。
 */
export function idleLogDue(cfg, now = Date.now()) {
  if (!(cfg.idleLogIntervalMs > 0)) return true;
  const stamp = path.join(cfg.logDir, 'idle-log.stamp');
  let last = 0;
  try {
    last = Number(fs.readFileSync(stamp, 'utf8')) || 0;
  } catch { /* 没有记录 */ }
  if (now - last < cfg.idleLogIntervalMs) return false;
  try {
    fs.mkdirSync(cfg.logDir, { recursive: true });
    fs.writeFileSync(stamp, String(now));
  } catch { /* 记不下就下次照打 */ }
  return true;
}
