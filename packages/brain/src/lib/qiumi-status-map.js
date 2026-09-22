/**
 * 秋米中文 GTD 表 ↔ Brain ↔ 英文 Tasks 库 三方状态映射（决策 b8abd28c）。
 * 唯一真身：改状态语义只改这里。缺项 = qiumi-status-map.test.js 报红，不允许静默不同步。
 *
 * 铁律：
 *  - 中文「收集/下一个行动/阻塞/淘汰」是人工专属态，AI 永不写（本表 zh 列绝不出现它们）；
 *  - 系统等待态（blocked/paused/quota_exhausted/pending_postdeploy）中文侧保持「进行中」，
 *    原因写进「OpenClaw结果」，不占人工「阻塞」位；
 *  - 失败/取消 → 「推迟」+ 清「OpenClaw任务号」（人把状态拖回「委派」= 重试，沿用旧脚本约定）。
 */
import { TASK_STATUSES } from './task-status-transitions.js';

export const ZH_HUMAN_ONLY_STATUSES = Object.freeze(['收集', '下一个行动', '阻塞', '淘汰']);
export const ZH_SYNCABLE_STATUSES = Object.freeze(['委派', '进行中', '推迟', '已完成']);

export const ZH_PRIORITY_TO_BRAIN = Object.freeze({ '极度': 'P0', '高': 'P1', '中': 'P2', '低': 'P2' });
export function zhPriorityToBrain(name) {
  return ZH_PRIORITY_TO_BRAIN[name] ?? 'P2';
}

const row = (zh, en, extra = {}) => Object.freeze({
  zh, en, zhWaiting: false, clearTaskNo: false, complete: false, ...extra,
});
const WAIT = row('进行中', 'Planned', { zhWaiting: true });
const FAIL = row('推迟', 'Cancelled', { clearTaskNo: true });
const DONE = row('已完成', 'Done', { complete: true });

export const QIUMI_STATUS_MAP = Object.freeze({
  pending: row(null, null),
  queued: row('委派', 'Delegated'),
  in_progress: row('进行中', 'In Progress'),
  blocked: WAIT,
  quota_exhausted: WAIT,
  paused: WAIT,
  pending_postdeploy: WAIT,
  quarantined: FAIL,
  dep_failed: FAIL,
  canceled: FAIL,
  cancelled: FAIL,
  failed: FAIL,
  completed: DONE,
  completed_no_pr: DONE,
  archived: row(null, null),
});

// 装载即自检：TASK_STATUSES 与表项一一对应（守卫测试之外的第二道保险）
for (const s of TASK_STATUSES) {
  if (!(s in QIUMI_STATUS_MAP)) throw new Error(`qiumi-status-map 缺 Brain 状态 ${s}`);
}

const text = (content) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];

/**
 * 一条 Brain 状态 → 中文页 PATCH properties；zh 为 null 返回 null（不写）。
 * @param {string} brainStatus
 * @param {{reason?:string, resultText?:string, today:string}} ctx today = YYYY-MM-DD（业务日）
 */
export function zhWriteFor(brainStatus, { reason = '', resultText = '', today } = {}) {
  const m = QIUMI_STATUS_MAP[brainStatus];
  if (!m || !m.zh) return null;
  const properties = { '状态': { status: { name: m.zh } } };
  if (m.zhWaiting) {
    properties['OpenClaw结果'] = { rich_text: text(`[等待中: ${reason || brainStatus}]`) };
  } else if (m.clearTaskNo) {
    properties['OpenClaw结果'] = { rich_text: text(`[执行失败: ${reason || brainStatus}] ${resultText}`.trim()) };
    properties['OpenClaw任务号'] = { rich_text: [] };
    properties['已完成'] = { checkbox: false };
  } else if (m.complete) {
    properties['OpenClaw结果'] = { rich_text: text(resultText || '已完成') };
    properties['已完成'] = { checkbox: true };
    properties['完成日期'] = { date: { start: today } };
  }
  return { properties };
}
