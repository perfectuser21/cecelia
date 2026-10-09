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
 *
 * 块头也可写成独占一行的「执行参数：」（Notion 中文任务模板写法，09-29 任务 319d933d 实证）。
 */

/**
 * 模型系列（决策 49d17c60）：任务里只写系列名，取允许清单里该系列的最新「纯版本号」型号。
 * 新版本进了允许清单就自动成为默认，任务写法不用改；允许清单只放实测能跑通的型号。
 * 带后缀/日期的变体（grok-4.20-reasoning、haiku-4-5-20251001）不参与「最新」比较，要用就写全名。
 */
const MODEL_FAMILIES = Object.freeze({
  sol: /^openai\/gpt-(\d+(?:\.\d+)?)-sol$/,
  terra: /^openai\/gpt-(\d+(?:\.\d+)?)-terra$/,
  luna: /^openai\/gpt-(\d+(?:\.\d+)?)-luna$/,
  astra: /^openai\/gpt-(\d+(?:\.\d+)?)-astra$/,
  opus: /^anthropic\/claude-opus-(\d+(?:-\d+)?)$/,
  sonnet: /^anthropic\/claude-sonnet-(\d+(?:-\d+)?)$/,
  fable: /^anthropic\/claude-fable-(\d+(?:-\d+)?)$/,
  haiku: /^anthropic\/claude-haiku-(\d+(?:-\d+)?)$/,
  grok: /^xai\/grok-(\d+(?:\.\d+)?)$/,
});

/** 旧简称 → 系列（兼容已写好的任务） */
export const MODEL_ALIASES = Object.freeze({ claude: 'sonnet', codex: 'terra' });

export const THINKING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max']);

// 块头两种写法：「【执行参数】」，或 Notion 中文模板的独占一行「执行参数：」（全/半角冒号，前后可有空白）。
// 后者必须行首且整行只有它，正文里「请参考下面的执行参数：」「执行参数：见附件」都不算块头。
// 不用 m 标志：块尾的 $ 必须仍表示文末。
const BLOCK_RE = /(?:【执行参数】|(?:^|\n)[ \t]*执行参数[ \t]*[：:][ \t]*(?=\n|$))([\s\S]*?)(?:【执行参数结束】|\n[ \t]*\n|$)/;
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

const versionParts = (v) => v.split(/[.-]/).map(Number);
const newerThan = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};

function latestInFamily(family, allowlist) {
  let best = null;
  for (const id of allowlist) {
    const v = id.match(MODEL_FAMILIES[family])?.[1];
    if (v && (!best || newerThan(v, best.v))) best = { id, v };
  }
  return best?.id ?? null;
}

/**
 * 模型：系列名（取最新）→ 清单全名 → 清单短名 → Claude 省略前缀/点号写法，全部精确匹配；不做后缀猜测。
 * 显示名里的空格按连字符处理：「GPT-6 Sol」=gpt-6-sol，「Opus 4.8」=claude-opus-4-8。
 */
function resolveModel(raw, allowlist) {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '-');
  const family = MODEL_ALIASES[t] ?? (MODEL_FAMILIES[t] ? t : null);
  if (family) return latestInFamily(family, allowlist);
  const candidates = [t, t.startsWith('claude-') ? null : `claude-${t}`]
    .filter(Boolean)
    .flatMap((c) => (c.startsWith('claude-') ? [c, c.replace(/\./g, '-')] : [c]));
  for (const c of candidates) {
    const full = allowlist.find((id) => id.toLowerCase() === c);
    if (full) return full;
    const short = allowlist.filter((id) => id.slice(id.indexOf('/') + 1).toLowerCase() === c);
    if (short.length === 1) return short[0];
  }
  return null;
}

/** 超时：N分钟 / N秒 / Nm / Ns / N（默认分钟）；越界返回 null。 */
function parseTimeout(raw) {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(分钟|min|m|秒|sec|s)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const sec = /^(秒|sec|s)$/.test(m[2] ?? '') ? n : n * 60;
  return sec >= TIMEOUT_MIN_SEC && sec <= TIMEOUT_MAX_SEC ? Math.round(sec) : null;
}

/**
 * 把正文拆成「有没有执行参数块」+「去掉块之后的其余正文」（任务 e3c81cce）。
 * 与 parseExecParams 用同一条 BLOCK_RE：路由认成参数块的那段，才是 prompt 里要摘掉的那段，
 * 两处判据只此一份。块所在位置补一个换行，前后正文不粘连。
 */
export function splitExecParamsBlock(body) {
  const text = String(body ?? '');
  if (!BLOCK_RE.test(text)) return { present: false, rest: text };
  return { present: true, rest: text.replace(BLOCK_RE, '\n').replace(/\n{3,}/g, '\n\n').trim() };
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
