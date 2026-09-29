/**
 * recurring-schedule.js — 定时引擎的纯计算部分（无 IO）：cron 解析、时区换算、下一个时间点、到点/基线/迟到判定、实例标题。
 * 执行（CAS 占位、建单、过期、告警）在 ../recurring.js。任务 3d0db274。
 *
 * recurrence_type：cron / daily / weekly 都按 cron_expression（5 段 cron）解释；interval 的 cron_expression 存分钟数。
 * day-of-month 与 day-of-week 同时限定时按 AND 匹配（沿用旧实现）。
 */

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const MINUTE_MS = 60 * 1000;
const DEFAULT_CATCHUP_MINUTES = 30;
const MAX_CATCHUP_MINUTES = 7 * 24 * 60;
const SEARCH_HORIZON_MS = 367 * 24 * 60 * MINUTE_MS;

// ─── cron 解析 ────────────────────────────────────────────────

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _formatters = new Map();

function zonedFields(date, timeZone) {
  if (!timeZone) {
    return { minute: date.getMinutes(), hour: date.getHours(), dom: date.getDate(), month: date.getMonth() + 1, dow: date.getDay() };
  }
  let fmt = _formatters.get(timeZone);
  if (!fmt) {
    // 非法时区在这里抛 RangeError，由调用方（单模板 try/catch）隔离
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
    _formatters.set(timeZone, fmt);
  }
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { minute: Number(p.minute), hour: Number(p.hour), dom: Number(p.day), month: Number(p.month), dow: WEEKDAY[p.weekday] };
}

/** Check if a cron field matches a value. Supports: * (wildcard), N (exact), N-M (range), N/S (step), N,M (list) */
function matchesField(spec, value, min, max) {
  if (spec === '*') return true;

  for (const part of spec.split(',')) {
    if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      let rangeStart = min;
      let rangeEnd = max;
      if (rangeStr !== '*') {
        if (rangeStr.includes('-')) {
          [rangeStart, rangeEnd] = rangeStr.split('-').map(Number);
        } else {
          rangeStart = parseInt(rangeStr, 10);
        }
      }
      for (let i = rangeStart; i <= rangeEnd; i += step) {
        if (i === value) return true;
      }
      continue;
    }
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (value >= start && value <= end) return true;
      continue;
    }
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

function splitCron(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return null;
  const parts = cronExpr.trim().split(/\s+/);
  return parts.length === 5 ? parts : null;
}

const CRON_PART_RE = /^(\*|\d+(-\d+)?)(\/\d+)?$/;

/** 5 段 cron 的语法校验（每段是 * / N / N-M，可带 /S，逗号分隔）。 */
export function isValidCron(cronExpr) {
  const parts = splitCron(cronExpr);
  if (!parts) return false;
  return parts.every((field) => field.split(',').every((p) => CRON_PART_RE.test(p)));
}

function hourLevelMatch(parts, f) {
  const [, hourSpec, domSpec, monthSpec, dowSpec] = parts;
  return matchesField(hourSpec, f.hour, 0, 23)
    && matchesField(domSpec, f.dom, 1, 31)
    && matchesField(monthSpec, f.month, 1, 12)
    && matchesField(dowSpec, f.dow, 0, 6);
}

/**
 * cron 是否命中给定时刻。timeZone 省略时按进程本地时区（旧语义，仅兼容保留）；
 * 引擎内部一律显式传时区。
 */
export function matchesCron(cronExpr, date, timeZone) {
  const parts = splitCron(cronExpr);
  if (!parts) return false;
  const f = zonedFields(date, timeZone);
  return matchesField(parts[0], f.minute, 0, 59) && hourLevelMatch(parts, f);
}

function nextCronMatchAfter(cronExpr, after, timeZone) {
  const parts = splitCron(cronExpr);
  if (!parts) return null;
  let t = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = after.getTime() + SEARCH_HORIZON_MS;
  while (t <= limit) {
    const f = zonedFields(new Date(t), timeZone);
    if (!hourLevelMatch(parts, f)) {
      t += (60 - f.minute) * MINUTE_MS; // 整小时不匹配，跳到本地下一个整点
      continue;
    }
    if (matchesField(parts[0], f.minute, 0, 59)) return new Date(t);
    t += MINUTE_MS;
  }
  return null;
}

// ─── 模板解释 ──────────────────────────────────────────────────

export function templateOf(rt) {
  const tpl = rt?.template;
  if (!tpl) return {};
  if (typeof tpl === 'string') {
    try { return JSON.parse(tpl) || {}; } catch { return {}; }
  }
  return typeof tpl === 'object' ? tpl : {};
}

export function timeZoneOf(rt) {
  return templateOf(rt).timezone || DEFAULT_TIMEZONE;
}

function intervalMs(rt) {
  const minutes = parseInt(rt.cron_expression, 10);
  return Number.isFinite(minutes) && minutes > 0 && /^\s*\d+\s*$/.test(String(rt.cron_expression)) ? minutes * MINUTE_MS : null;
}

function catchupMs(rt) {
  const raw = Number(templateOf(rt).catchup_minutes);
  const minutes = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, MAX_CATCHUP_MINUTES) : DEFAULT_CATCHUP_MINUTES;
  return minutes * MINUTE_MS;
}

export function minutesOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 严格晚于 after 的下一个时间点（模板时区）。无法计算返回 null。 */
export function nextSlotAfter(rt, after) {
  if (rt.recurrence_type === 'interval') {
    const iv = intervalMs(rt);
    return iv ? new Date(after.getTime() + iv) : null;
  }
  return nextCronMatchAfter(rt.cron_expression, after, timeZoneOf(rt));
}

/** 兼容旧导出：下一次运行时间（基于 now）。 */
export function calculateNextRunAt(rt, now = new Date()) {
  return nextSlotAfter(rt, now);
}

/** 路由用：recurrence_type + cron_expression + template.timezone 的合法性。合法返回 null，否则返回错误说明。 */
export function validateSchedule({ recurrence_type = 'cron', cron_expression, template } = {}) {
  const tpl = templateOf({ template });
  if (template != null && (typeof template !== 'object' || Array.isArray(template))) return 'template 必须是 JSON 对象';
  if (tpl.timezone) {
    try { zonedFields(new Date(), tpl.timezone); } catch { return `template.timezone 非法: ${tpl.timezone}`; }
  }
  if (cron_expression == null) return null;
  if (recurrence_type === 'interval') {
    return intervalMs({ cron_expression }) ? null : 'interval 类型的 cron_expression 必须是正整数分钟数';
  }
  return isValidCron(cron_expression) ? null : `cron_expression 非法（需 5 段 cron）: ${cron_expression}`;
}

/** 表达式本身是否合法（不知道 recurrence_type 时用：5 段 cron 或正整数分钟都认）。 */
export function isValidScheduleExpression(expr) {
  return isValidCron(expr) || intervalMs({ cron_expression: expr }) != null;
}

/**
 * 纯函数：给模板当前状态定动作。
 * @returns {{action:'wait'}|{action:'baseline',nextRunAt:Date|null}|{action:'run',slot:Date,nextRunAt:Date|null}|{action:'missed',slot:Date,nextRunAt:Date|null}}
 */
export function planTemplate(rt, now) {
  if (!rt.next_run_at) return { action: 'baseline', nextRunAt: nextSlotAfter(rt, now) };
  const old = new Date(rt.next_run_at);
  if (now.getTime() < old.getTime()) return { action: 'wait' };

  const windowMs = catchupMs(rt);
  if (rt.recurrence_type === 'interval') {
    const iv = intervalMs(rt);
    if (!iv) throw new Error(`interval 非法: ${rt.cron_expression}`);
    const latest = new Date(old.getTime() + Math.floor((now.getTime() - old.getTime()) / iv) * iv);
    const nextRunAt = new Date(latest.getTime() + iv);
    return now.getTime() - latest.getTime() <= windowMs
      ? { action: 'run', slot: latest, nextRunAt }
      : { action: 'missed', slot: latest, nextRunAt };
  }

  const tz = timeZoneOf(rt);
  const nextRunAt = nextCronMatchAfter(rt.cron_expression, now, tz);
  const windowStart = Math.max(old.getTime(), now.getTime() - windowMs);
  for (let t = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS; t >= windowStart; t -= MINUTE_MS) {
    const d = new Date(t);
    if (matchesCron(rt.cron_expression, d, tz)) return { action: 'run', slot: d, nextRunAt };
  }
  // 窗口内没有命中：next_run_at 本身还在窗口内（如秒级偏移的旧数据）就按它跑，否则 missed
  if (now.getTime() - old.getTime() <= windowMs) return { action: 'run', slot: old, nextRunAt };
  return { action: 'missed', slot: old, nextRunAt };
}

// ─── 实例标题 ──────────────────────────────────────────────────

const TITLE_MAX = 255;
const _labelFormatters = new Map();

/** 时间点在模板时区下的标签，如 2026-09-29 22:00。 */
function slotLabel(slot, timeZone) {
  let fmt = _labelFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    _labelFormatters.set(timeZone, fmt);
  }
  const p = {};
  for (const part of fmt.formatToParts(slot)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * 实例标题 = 模板标题 · 时间点。tasks 上有 (title) WHERE status IN ('cancelled','canceled') 唯一索引（迁移 074），
 * 同标题的实例第二次过期取消会撞索引——标题必须按时间点区分。
 */
export function instanceTitle(base, slot, timeZone) {
  const suffix = ` · ${slotLabel(slot, timeZone)}`;
  return `${String(base).slice(0, TITLE_MAX - suffix.length)}${suffix}`;
}
