/**
 * exec-params.js — 解析秋米任务正文顶部的【执行参数】块（任务 0d4215f2，决策 56328560）。
 *
 * 取代 cheap-gates 里的「用 <型号>」正则：那条正则把模板里的「调用Agent：」匹配成 token `agent`，
 * 再按后缀唯一命中 xai/grok-4.20-multi-agent，09-23 起 Notion 秋米任务全挂。
 * 这里只认固定字段名；解析不出就进 errors 由路由判 fail，绝不回落到正则猜测。
 *
 * 块格式（结束标记可省，省略时读到第一个空行为止）：
 *   【执行参数】
 *   执行Agent：media
 *   模型：claude
 *   超时：30分钟
 *   验收：……
 *   设备：小龙虾
 *   思考强度：high
 *   【执行参数结束】
 */

export const MODEL_ALIASES = Object.freeze({
  claude: 'anthropic/claude-sonnet-5',
  codex: 'openai/gpt-5.6-terra',
  terra: 'openai/gpt-5.6-terra',
  sol: 'openai/gpt-6-sol',
  grok: 'xai/grok-4.7',
});

export const THINKING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max']);

const BLOCK_RE = /【执行参数】([\s\S]*?)(?:【执行参数结束】|\n[ \t]*\n|$)/;
const SAFE_AGENT = /^[A-Za-z0-9._-]+$/;
const TIMEOUT_MIN_SEC = 60;
const TIMEOUT_MAX_SEC = 180 * 60;

const FIELD_KEYS = Object.freeze({
  执行agent: 'agent', agent: 'agent', 执行者: 'agent',
  模型: 'model', model: 'model',
  超时: 'timeout', timeout: 'timeout',
  验收: 'acceptance',
  设备: 'device',
  思考强度: 'thinking', thinking: 'thinking',
});

const normKey = (k) => k.replace(/\s+/g, '').toLowerCase();

/** 模型：别名 → 清单全名 → 清单短名，全部精确匹配；不做后缀猜测。 */
function resolveModel(raw, allowlist) {
  const t = raw.trim().toLowerCase();
  if (MODEL_ALIASES[t]) return MODEL_ALIASES[t];
  const full = allowlist.find((id) => id.toLowerCase() === t);
  if (full) return full;
  const short = allowlist.filter((id) => id.slice(id.indexOf('/') + 1).toLowerCase() === t);
  return short.length === 1 ? short[0] : null;
}

/** 超时：N分钟 / N秒 / Nm / Ns / N（默认分钟）；越界返回 null。 */
function parseTimeout(raw) {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(分钟|min|m|秒|sec|s)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const sec = /^(秒|sec|s)$/.test(m[2] ?? '') ? n : n * 60;
  return sec >= TIMEOUT_MIN_SEC && sec <= TIMEOUT_MAX_SEC ? Math.round(sec) : null;
}

export function parseExecParams(body, env = {}) {
  const out = {
    present: false, agent: null, model: null, modelRaw: null, timeoutSec: null,
    acceptance: null, device: null, thinking: null, errors: [],
  };
  const m = String(body ?? '').match(BLOCK_RE);
  if (!m) return out;
  out.present = true;
  const allowlist = env.modelAllowlist ?? [];

  for (const line of m[1].split('\n')) {
    const sep = line.search(/[：:]/);
    if (sep < 0) continue;
    const field = FIELD_KEYS[normKey(line.slice(0, sep))];
    const value = line.slice(sep + 1).trim();
    if (!field || !value) continue;

    if (field === 'agent') {
      if (SAFE_AGENT.test(value)) out.agent = value;
      else out.errors.push('bad_agent');
    } else if (field === 'model') {
      out.modelRaw = value;
      out.model = resolveModel(value, allowlist);
      if (!out.model) out.errors.push('unknown_model');
    } else if (field === 'timeout') {
      out.timeoutSec = parseTimeout(value);
      if (out.timeoutSec == null) out.errors.push('bad_timeout');
    } else if (field === 'thinking') {
      const v = value.toLowerCase();
      if (THINKING_LEVELS.includes(v)) out.thinking = v;
      else out.errors.push('bad_thinking');
    } else {
      out[field] = value;
    }
  }
  return out;
}
