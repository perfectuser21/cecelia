/**
 * 秋米任务排期时间归一（决策 51c09285，任务 0b3592c9）。
 * 中文表「预期开始时间」= 开始执行时间，写进 payload.next_run_at，派发器没到点不派
 * （dispatch-helpers.js selectNextDispatchableTask 的 next_run_at 谓词）；「预期结束时间」= 截止 due_at。
 * Notion 日期只填日期不填钟点时是 'YYYY-MM-DD'：开始按当天 00:00、结束按当天 23:59:59，一律上海时间。
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TZ_OFFSET = '+08:00';

export function toStartIso(value) {
  if (!value) return null;
  return DATE_ONLY.test(value) ? `${value}T00:00:00${TZ_OFFSET}` : value;
}

export function toEndIso(value) {
  if (!value) return null;
  return DATE_ONLY.test(value) ? `${value}T23:59:59${TZ_OFFSET}` : value;
}

export function isFuture(iso, now = new Date()) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** 同一时刻（不同写法/时区也算相同）；两边都空也算相同。 */
export function sameInstant(a, b) {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** 上海时间的月/日/时/分。 */
function shanghaiParts(iso) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** 等待期写进中文「OpenClaw结果」的提示，按上海时间显示。 */
export function scheduledNote(iso) {
  const parts = shanghaiParts(iso);
  return `🕐 已排期 ${parts.month}-${parts.day} ${parts.hour}:${parts.minute}，到点派发`;
}

/** 手机忙排队等待（任务 5ad81457，lib/qiumi-device-busy.js）写进「OpenClaw结果」的提示，上海时间。 */
export function deviceBusyNote({ owner, nextRunAt, attempts }) {
  const parts = shanghaiParts(nextRunAt);
  return `⏳ 手机忙（被 ${owner || '其他运行'} 占用），已排队，${parts.hour}:${parts.minute} 后重试（第 ${attempts} 次）`;
}

/** 手机忙等到截止仍未执行（failed(device_busy_expired)，lib/qiumi-device-busy.js）写进「OpenClaw结果」的提示。 */
export function deviceBusyExpiredNote({ owner }) {
  return `⌛ 到截止时间仍未轮到手机（一直被 ${owner || '其他运行'} 占用），未执行`;
}
