// packages/brain/src/routing/redact.js
// 正文全发给第三方判定器前打码（主理人拍板：全发但打码 key/token/密码）。只打值，不删行。
// 前两类是「标签+分隔符+值」结构，用捕获组保留标签只换值；
// 后两类（sk-.../ghp_...）本身就是值，整段替换为 [REDACTED]。
const LABELED_PATTERNS = [
  /((?:api[_-]?key|token|secret|password|passwd|密码|口令)\s*[:=：]\s*)\S+/gi,
  /(\bBearer\s+)[A-Za-z0-9._-]+/gi,
];
const BARE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\b(?:ghp|gho|ghs|xoxb|xoxp)_[A-Za-z0-9]{10,}/g,
];
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of LABELED_PATTERNS) out = out.replace(re, '$1[REDACTED]');
  for (const re of BARE_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}
