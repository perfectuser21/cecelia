/* eslint-disable no-undef */ // Node ESM 全局(process/fetch/console/AbortSignal)
// deadman / 心跳 — 治「静默暴毙」。现状: 写本地心跳文件 + stale 判定。
// SEAM(Agent C 升级): deadmanCheck 报红时除 stderr 外,接飞书告警 webhook。
//   复用 notifier.js 群机器人 webhook 模式: FEISHU_BOT_WEBHOOK 配了发文本告警;
//   缺则降级(打日志不崩, 绝不写死 key)。告警本身失败也不能拖垮 deadman。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HEARTBEAT_FILE = path.join(__dirname, '.heartbeat.json');
const STALE_MS = Number(process.env.STALE_MS || 60_000);

export function createDeadman({ heartbeatFile = HEARTBEAT_FILE, now = Date.now } = {}) {
  function beat(stage) {
    fs.writeFileSync(heartbeatFile, JSON.stringify({ ts: now(), stage }, null, 2));
  }
  function isStale(thresholdMs = STALE_MS) {
    if (!fs.existsSync(heartbeatFile)) return { stale: true, reason: '无心跳文件,指挥从未启动或已死' };
    let record;
    try { record = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8')); }
    catch { return { stale: true, reason: '心跳文件无效，无法确认存活' }; }
    if (!record || !Number.isFinite(record.ts)) return { stale: true, reason: '心跳时间无效，无法确认存活' };
    const { ts, stage } = record;
    const ageMs = now() - ts;
    if (ageMs > thresholdMs) return { stale: true, stage, ageMs, reason: `心跳 stale ${Math.round(ageMs / 1000)}s` };
    return { stale: false, stage, ageMs };
  }
  return { beat, isStale };
}
const monitor = createDeadman();
export const beat = monitor.beat;
export const isStale = monitor.isStale;

// 飞书告警(复用 notifier.js 群机器人 webhook 模式)。
// FEISHU_BOT_WEBHOOK 未配 → 降级返回 false(打日志不崩); 发送失败也返回 false(不抛)。
export async function alertFeishu({ stage, ageMs, reason }) {
  const webhook = process.env.FEISHU_BOT_WEBHOOK || '';
  const ageSec = Math.round((ageMs || 0) / 1000);
  const text = `🔴 ZenithJoy Autopilot DEADMAN\n${reason || '心跳异常'}\nstage=${stage || '?'} age=${ageSec}s → 喊主理人`;
  if (!webhook) {
    console.error('[deadman] FEISHU_BOT_WEBHOOK 未配置, 飞书告警降级(仅 stderr)');
    return false;
  }
  try {
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.error(`[deadman] 飞书 webhook 返回 ${resp.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[deadman] 飞书告警发送失败(不拖垮 deadman): ${err.message}`);
    return false;
  }
}

// CLI 入口: stale 报红时 stderr + 飞书告警, 然后 exit 1; 否则打绿日志。
export async function deadmanCheck() {
  const r = isStale();
  if (r.stale) {
    console.error(`🔴 DEADMAN: ${r.reason}${r.stage ? ` (stage=${r.stage})` : ''} → 喊主理人`);
    await alertFeishu(r);
    process.exit(1);
  }
  console.log(`🟢 心跳正常: ${Math.round(r.ageMs / 1000)}s 前 (stage=${r.stage})`);
}
