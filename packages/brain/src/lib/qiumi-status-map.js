/**
 * 秋米中文 GTD 表 ↔ Brain ↔ 英文 Tasks 库 三方状态映射（决策 b8abd28c；2026-10-10 改为中英文一一对应）。
 * 唯一真身：改状态语义只改这里。缺项 = qiumi-status-map.test.js 报红，不允许静默不同步。
 *
 * 铁律：
 *  - 中文「收集/下一个行动/阻塞」是人工专属态，AI 永不写（本表 zh 列绝不出现它们）；
 *  - 「委派」不是 Brain 状态，只作拉取入口（委派 ∧ 任务号空 → 建 Brain 任务），映射输出里永不出现；
 *  - 「淘汰」：主理人拖入 = 急停；cancelled 任务 AI 也回写「淘汰」让两边一致。
 *    急停读到「淘汰 ∧ brain:xxx」时，Brain 任务若已是终态则不再触发任何变更（lib/qiumi-owner-stops.js），
 *    所以 AI 写的淘汰不会回头变成新的取消命令；
 *  - 系统等待态（blocked/paused/quota_exhausted/pending_postdeploy）→「受阻」，原因写进「OpenClaw结果」。
 *    例外：delegated_device_job（转手机领单通道，不是出错）→「进行中」；
 *    owner_hold（主理人自己拖的「阻塞」）中文不写，页面保持主理人设的「阻塞」，英文 Blocked；
 *  - 失败/隔离/依赖失败 →「失败」+ 清「OpenClaw任务号」（人把状态拖回「委派」= 重试，沿用旧脚本约定）；
 *  - 旧页上的「推迟」只识别、不再写（ZH_SYNCABLE_STATUSES 保留它仅为让回写能覆盖旧页）。
 */
import { TASK_STATUSES } from './task-status-transitions.js';

export const ZH_HUMAN_ONLY_STATUSES = Object.freeze(['收集', '下一个行动', '阻塞']);
export const ZH_SYNCABLE_STATUSES = Object.freeze(['排队中', '进行中', '受阻', '失败', '已完成', '淘汰', '推迟']);

export const OWNER_HOLD_REASON = 'owner_hold';
export const DELEGATED_DEVICE_REASON = 'delegated_device_job';

export const ZH_PRIORITY_TO_BRAIN = Object.freeze({ '极度': 'P0', '高': 'P1', '中': 'P2', '低': 'P2' });
export function zhPriorityToBrain(name) {
  return ZH_PRIORITY_TO_BRAIN[name] ?? 'P2';
}

const row = (zh, en, extra = {}) => Object.freeze({
  zh, en, zhWaiting: false, clearTaskNo: false, complete: false, ...extra,
});
const WAIT = row('受阻', 'Blocked', { zhWaiting: true });
const FAIL = row('失败', 'Failed', { clearTaskNo: true });
const CANCEL = row('淘汰', 'Cancelled');
const DONE = row('已完成', 'Done', { complete: true });

export const QIUMI_STATUS_MAP = Object.freeze({
  pending: row(null, null),
  queued: row('排队中', 'Queued'),
  in_progress: row('进行中', 'In Progress'),
  blocked: WAIT,
  quota_exhausted: WAIT,
  paused: WAIT,
  pending_postdeploy: WAIT,
  quarantined: FAIL,
  dep_failed: FAIL,
  failed: FAIL,
  canceled: CANCEL,
  cancelled: CANCEL,
  completed: DONE,
  completed_no_pr: DONE,
  archived: row(null, null),
});

// 装载即自检：TASK_STATUSES 与表项一一对应（守卫测试之外的第二道保险）
for (const s of TASK_STATUSES) {
  if (!(s in QIUMI_STATUS_MAP)) throw new Error(`qiumi-status-map 缺 Brain 状态 ${s}`);
}

/** 英文 Tasks 库 Status；blocked + delegated_device_job 是转手机领单通道，不算受阻。 */
export function enStatusFor(brainStatus, { blockedReason = null } = {}) {
  const m = QIUMI_STATUS_MAP[brainStatus];
  if (!m) return null;
  if (brainStatus === 'blocked' && blockedReason === DELEGATED_DEVICE_REASON) return 'In Progress';
  return m.en;
}

const text = (content) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];

/**
 * 这些阻塞原因的 error_message 本身就是写给主理人看的提示，原样进「OpenClaw结果」，不套 [受阻: …]。
 * device_unresolved：手机定不下（routing/qiumi-router.js holdUnresolved），提示由台账昵称生成。
 */
const ZH_VERBATIM_BLOCK_REASONS = Object.freeze(['device_unresolved']);

/**
 * 一条 Brain 状态 → 中文页 PATCH properties；zh 为 null 返回 null（不写）。
 * @param {string} brainStatus
 * @param {{reason?:string, resultText?:string, today:string, blockedReason?:string|null}} ctx today = YYYY-MM-DD（业务日）
 */
export function zhWriteFor(brainStatus, { reason = '', resultText = '', today, blockedReason = null } = {}) {
  const m = QIUMI_STATUS_MAP[brainStatus];
  if (!m || !m.zh) return null;
  const blocked = brainStatus === 'blocked';
  // 主理人自己拖的「阻塞」：页面保持人工态，AI 不写中文
  if (blocked && blockedReason === OWNER_HOLD_REASON) return null;
  if (blocked && blockedReason === DELEGATED_DEVICE_REASON) {
    return { properties: {
      '状态': { status: { name: QIUMI_STATUS_MAP.in_progress.zh } },
      'OpenClaw结果': { rich_text: text('[已转手机领单通道]') },
    } };
  }
  const properties = { '状态': { status: { name: m.zh } } };
  if (m.zhWaiting && reason && ZH_VERBATIM_BLOCK_REASONS.includes(blockedReason)) {
    properties['OpenClaw结果'] = { rich_text: text(reason) };
  } else if (m.zhWaiting) {
    properties['OpenClaw结果'] = { rich_text: text(`[受阻: ${reason || brainStatus}]`) };
  } else if (m === CANCEL) {
    properties['OpenClaw结果'] = { rich_text: text(`[已取消: ${reason || brainStatus}]`) };
  } else if (m.clearTaskNo) {
    properties['OpenClaw结果'] = { rich_text: text(`[执行失败: ${reason || brainStatus}] ${resultText}`.trim()) };
    properties['OpenClaw任务号'] = { rich_text: [] };
    properties['已完成'] = { checkbox: false };
  } else if (m.complete) {
    properties['OpenClaw结果'] = { rich_text: text(resultText || '已完成') };
    properties['已完成'] = { checkbox: true };
    properties['完成日期'] = { date: { start: today } };
  } else if (brainStatus === 'in_progress' && resultText) {
    properties['OpenClaw结果'] = { rich_text: text(resultText) };
  }
  return { properties };
}
