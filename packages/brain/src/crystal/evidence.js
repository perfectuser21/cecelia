/**
 * 结晶判官 — 证据留存规范（决策 28ca1f69 INV-4：证据留痕）
 *
 * 截图/轨迹文件名必须带 trial + timestamp，禁复用文件名覆盖。
 * 文件名格式：`<grid>__trial<N>__<YYYYMMDDThhmmssZ>.<ext>`
 * 例：og1__trial3__20260905T221000Z.png
 */

const TRIAL_RE = /trial(\d+)/;
const TIMESTAMP_RE = /(\d{8}T\d{6}Z)/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 把 Date 格式化为紧凑 UTC 时间戳 YYYYMMDDThhmmssZ。
 */
function formatUtcTimestamp(at) {
  const d = at instanceof Date ? at : new Date(at);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/**
 * 构造合规证据文件名（强制带 trial + timestamp）。
 * @param {{grid:string, trial:number, ext?:string, at?:Date}} param0
 * @returns {string}
 */
export function buildEvidenceFilename({ grid, trial, ext = 'png', at = new Date() }) {
  if (grid === undefined || grid === null || String(grid).length === 0) {
    throw new Error('buildEvidenceFilename: grid is required');
  }
  if (!Number.isInteger(trial) || trial < 0) {
    throw new Error('buildEvidenceFilename: trial must be a non-negative integer');
  }
  const ts = formatUtcTimestamp(at);
  const cleanExt = String(ext).replace(/^\./, '');
  return `${grid}__trial${trial}__${ts}.${cleanExt}`;
}

/**
 * 解析证据文件名，抽出 trial（数字）与 timestamp（字符串）。
 * 缺 trial 或 timestamp 时对应字段为 null。
 * @param {string} name
 * @returns {{grid:(string|null), trial:(number|null), timestamp:(string|null), ext:(string|null), valid:boolean}}
 */
export function parseEvidenceFilename(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { grid: null, trial: null, timestamp: null, ext: null, valid: false };
  }
  const trialMatch = name.match(TRIAL_RE);
  const tsMatch = name.match(TIMESTAMP_RE);
  const trial = trialMatch ? Number(trialMatch[1]) : null;
  const timestamp = tsMatch ? tsMatch[1] : null;
  const extMatch = name.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1] : null;
  const gridMatch = name.match(/^([^_]+)__/);
  const grid = gridMatch ? gridMatch[1] : null;
  return {
    grid,
    trial,
    timestamp,
    ext,
    valid: trial !== null && timestamp !== null,
  };
}

/**
 * 禁复用文件名覆盖：name 命中 existing 列表即抛错。
 * @param {string[]} existing - 已存在的文件名列表
 * @param {string} name - 待写入的文件名
 */
export function assertNoOverwrite(existing, name) {
  const list = Array.isArray(existing) ? existing : [];
  if (list.includes(name)) {
    throw new Error(`evidence_filename_overwrite_forbidden: ${name}`);
  }
}
