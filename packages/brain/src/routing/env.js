/**
 * 秋米路由 env 集中读取（brain 无 env 登记机制，本文件即清单）：
 *  QIUMI_MMV_CONCURRENCY  原生Agent宿主并发上限（机器闸），默认 2
 *  QIUMI_DISPATCH_ENABLED 'true' 才允许 tick 派发 qiumi_task（PR2 入账不再写 headed_manual）
 *  QIUMI_DEPARTMENTS      JSON 数组，受信部门标签
 *  QIUMI_AI_ACCOUNT_MAP  JSON，显式账号标签映射
 *  QIUMI_MODEL_ALLOWLIST  JSON 数组，允许的显式模型引用；正文「用 <型号>」只认清单内
 *  QIUMI_DEVICE_KEYWORDS  JSON 数组，便宜闸设备关键词
 *  QIUMI_DEVICE_DELEGATION_ENABLED 旧手机通道互斥标志；开启时独立RPA队列不派发
 * 改 env 必须重建容器（learning cp-0916213853）。
 */
const DEFAULT_DEPARTMENTS = ['main', 'infra', 'dev', 'media', 'people', 'fde'];
const DEFAULT_DEVICE_KEYWORDS = ['手机', '点赞', '发布', '朋友圈', '抖音', 'adb', '私信', '小红书', '快手', '视频号'];

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function qiumiEnv(env = process.env) {
  const conc = Number.parseInt(env.QIUMI_MMV_CONCURRENCY ?? '2', 10);
  return Object.freeze({
    mmvConcurrency: Number.isFinite(conc) && conc > 0 ? conc : 2,
    dispatchEnabled: env.QIUMI_DISPATCH_ENABLED === 'true',
    departments: parseJson(env.QIUMI_DEPARTMENTS, DEFAULT_DEPARTMENTS),
    aiAccountMap: (() => { const v = parseJson(env.QIUMI_AI_ACCOUNT_MAP, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })(),
    deviceKeywords: parseJson(env.QIUMI_DEVICE_KEYWORDS, DEFAULT_DEVICE_KEYWORDS),
    modelAllowlist: (() => { const v = parseJson(env.QIUMI_MODEL_ALLOWLIST, []); return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.includes('/')))] : []; })(),
    deviceDelegationEnabled: env.QIUMI_DEVICE_DELEGATION_ENABLED === 'true',
  });
}

/** 「用 <token>」→ 允许清单里的完整型号 id；全名 > 短名全等 > 以 -token 结尾（唯一才算），否则 null。 */
export function resolveModelRef(token, env = qiumiEnv()) {
  const t = String(token ?? '').trim().toLowerCase();
  if (t.length < 3) return null;
  const list = env.modelAllowlist ?? [];
  const full = list.find((id) => id.toLowerCase() === t);
  if (full) return full;
  const short = (id) => id.slice(id.indexOf('/') + 1).toLowerCase();
  const exact = list.filter((id) => short(id) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const suffix = list.filter((id) => short(id).endsWith(`-${t}`));
  return suffix.length === 1 ? suffix[0] : null;
}
