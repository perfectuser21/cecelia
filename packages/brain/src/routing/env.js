/**
 * 秋米路由 env 集中读取（brain 无 env 登记机制，本文件即清单）：
 *  JEV_API_KEY            TypeSafe Jev key（1Password「Jev API Key (TypeSafe)」→ 容器 env）
 *  JEV_ENDPOINT           默认 https://api.typesafe.ai/v1/systemone
 *  JEV_MODEL               默认 jev-latest
 *  QIUMI_FALLBACK_MODEL   terra 兜底模型（callLLM provider=openai），默认 gpt-5.6-terra
 *  QIUMI_MMV_CONCURRENCY  MMV 非设备 openclaw-agent 并发上限（机器闸），默认 2
 *  QIUMI_DISPATCH_ENABLED 'true' 才允许 tick 派发 qiumi_task（PR2 入账不再写 headed_manual）
 *  QIUMI_DEPARTMENTS      JSON 数组，Jev department 选项（= openclaw agents 部门清单）
 *  QIUMI_MODEL_MAP        JSON，engine → `openclaw agent --model` 值
 *  QIUMI_MODEL_ALLOWLIST  JSON 数组，OpenClaw agents.defaults.modelPolicy.allow 原样；正文「用 <型号>」只认清单内
 *  QIUMI_DEVICE_KEYWORDS  JSON 数组，便宜闸设备关键词
 *  QIUMI_DEVICE_DELEGATION_ENABLED 'true' 才把手机活派生成 device_job 交西安领单器；默认关＝手机活也派给 openclaw agent（主理人 0923 拍板）
 *  QIUMI_PHONE_NODE_MAP  JSON {host: OpenClaw 节点名}，缺省按 host 大写 + '-PHONE' 派生
 * 改 env 必须重建容器（learning cp-0916213853）。
 */
const DEFAULT_DEPARTMENTS = ['main', 'infra', 'dev', 'media', 'people', 'fde'];
const DEFAULT_MODEL_MAP = {
  // claude-cli 通道 0923 实测任何型号 180s 无输出，已判死（债 419ab185）→ 走 anthropic 原生 API
  claude: 'anthropic/claude-sonnet-5',
  codex: 'openai/gpt-5.3-codex',
  terra: 'openai/gpt-5.6-terra',
};
const DEFAULT_DEVICE_KEYWORDS = ['手机', '点赞', '发布', '朋友圈', '抖音', 'adb', '私信', '小红书', '快手', '视频号'];

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function qiumiEnv(env = process.env) {
  const conc = Number.parseInt(env.QIUMI_MMV_CONCURRENCY ?? '2', 10);
  return Object.freeze({
    jevApiKey: env.JEV_API_KEY || null,
    jevEndpoint: env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone',
    jevModel: env.JEV_MODEL || 'jev-latest',
    fallbackModel: env.QIUMI_FALLBACK_MODEL || 'gpt-5.6-terra',
    mmvConcurrency: Number.isFinite(conc) && conc > 0 ? conc : 2,
    dispatchEnabled: env.QIUMI_DISPATCH_ENABLED === 'true',
    departments: parseJson(env.QIUMI_DEPARTMENTS, DEFAULT_DEPARTMENTS),
    modelMap: { ...DEFAULT_MODEL_MAP, ...parseJson(env.QIUMI_MODEL_MAP, {}) },
    deviceKeywords: parseJson(env.QIUMI_DEVICE_KEYWORDS, DEFAULT_DEVICE_KEYWORDS),
    modelAllowlist: (() => { const v = parseJson(env.QIUMI_MODEL_ALLOWLIST, []); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.includes('/')) : []; })(),
    deviceDelegationEnabled: env.QIUMI_DEVICE_DELEGATION_ENABLED === 'true',
    phoneNodeMap: parseJson(env.QIUMI_PHONE_NODE_MAP, {}),
  });
}

/** 「用 <token>」→ 允许清单里的完整型号 id；全名 > 短名全等 > 以 -token 结尾（唯一才算），否则 null。 */
export function resolveModelRef(token, env = qiumiEnv()) {
  const t = String(token ?? '').trim();
  if (t.length < 3) return null;
  const list = env.modelAllowlist ?? [];
  if (list.includes(t)) return t;
  const short = (id) => id.slice(id.indexOf('/') + 1);
  const exact = list.filter((id) => short(id) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const suffix = list.filter((id) => short(id).endsWith(`-${t}`));
  return suffix.length === 1 ? suffix[0] : null;
}

/** 手机宿主 → OpenClaw 节点名。映射表优先，否则按 `<HOST>-PHONE` 派生（xian-m4 → XIAN-M4-PHONE）。 */
export function phoneNodeName(host, env = qiumiEnv()) {
  if (!host) return null;
  return env.phoneNodeMap?.[host] ?? `${String(host).toUpperCase()}-PHONE`;
}
