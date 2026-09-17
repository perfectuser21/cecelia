/**
 * credential-freshness.js — 凭据保鲜守卫
 *
 * ── 案卷（2026-09-16/17 一夜实证）──────────────────────────────────────
 * 凭据到期在这套系统里完全无人看守。一晚上撞出三条：
 *   · Tailscale API key 过期 18 天没人知道，直到 CI 红了才反查出来
 *   · 1Password 里的备用 GitHub PAT：元数据什么都没写，实际早已 401
 *   · 99 个凭据条目里只有 1 个写了到期日
 *
 * 由此定下本模块的设计原则：
 *
 * 1）**元数据只是声明，活性探测才是真相。**
 *    今晚那把 PAT 谁都没说它过期，它就是不能用了。所以"读到期日"只能用来提前预警，
 *    "能不能用"必须定期真去调一次。两条腿都要有：缺前者只能等爆，缺后者会被谎报。
 *
 * 2）**没有到期信息 ≠ 没问题。**
 *    classifyExpiry(null) 返回 unknown 而不是 ok —— 因为今晚出事的恰恰是"没写"的那把。
 *
 * 3）**探测出错算失活。**
 *    网络抖动导致的误报，代价是看一眼告警；把失活当成通过，代价是下次 CI 全红时才发现。
 *
 * 4）**能自动续的自动续，不能的就老实说。**
 *    Tailscale auth key（让机器加入网络）可以用 API token 自动续；
 *    但 API token 自己不能用旧 token 生成新的（Tailscale 的安全设计，不是偷懒）。
 *    所以守卫的目标不是"全自动"，而是把主理人要盯的从"随时可能爆的一堆"
 *    收敛成"90 天一次、且提前 14 天有预告的一件"。
 */

/** 到期前多少天开始预警 */
export const EXPIRY_WARN_DAYS = 14;
/** auth key 剩多少天时自动续期（留足失败重试余量） */
export const AUTH_KEY_ROTATE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 距到期还有几天。
 * 无法解析一律返回 null —— 绝不能退化成 0，那会被当成"今天到期"触发误续期。
 */
export function daysUntil(dateStr, nowMs = Date.now()) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\d{4}-\d{2}-\d{2}/);
  if (!m) return null;
  const t = Date.parse(`${m[0]}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.round((t - nowMs) / DAY_MS);
}

/** expired | warn | ok | unknown —— 没有到期信息判 unknown，不判 ok */
export function classifyExpiry(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARN_DAYS) return 'warn';
  return 'ok';
}

/**
 * 该探哪些凭据。
 * 只收"有明确探测手段"的条目——探不了的放进来只会制造假安全感。
 * 每个 probe 收 { fetchFn, env } 返回 { ok, detail }。
 */
export function buildProbePlan() {
  return [
    {
      name: 'tailscale_api',
      description: 'Tailscale API token（管理设备/签发 auth key）',
      probe: async ({ fetchFn, env }) => {
        const key = env.TAILSCALE_API_KEY;
        if (!key) return { ok: false, detail: '凭据缺失：TAILSCALE_API_KEY 未配置' };
        const auth = Buffer.from(`${key}:`).toString('base64');
        const res = await fetchFn('https://api.tailscale.com/api/v2/tailnet/-/devices', {
          headers: { Authorization: `Basic ${auth}` },
        });
        return res.status === 200
          ? { ok: true, detail: 'HTTP 200' }
          : { ok: false, detail: `HTTP ${res.status}` };
      },
    },
    {
      name: 'github_pat',
      description: 'GitHub PAT（CI/发布用）',
      probe: async ({ fetchFn, env }) => {
        const token = env.GITHUB_TOKEN || env.GH_TOKEN;
        if (!token) return { ok: false, detail: '凭据缺失：GITHUB_TOKEN 未配置' };
        const res = await fetchFn('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'cecelia-credential-freshness' },
        });
        return res.status === 200
          ? { ok: true, detail: 'HTTP 200' }
          : { ok: false, detail: `HTTP ${res.status}` };
      },
    },
    {
      name: 'feishu_app',
      description: '飞书 app 凭据（群消息归集用）',
      probe: async ({ fetchFn, env }) => {
        const id = env.FEISHU_APP_ID;
        const secret = env.FEISHU_APP_SECRET;
        if (!id || !secret) return { ok: false, detail: '凭据缺失：FEISHU_APP_ID/SECRET 未配置' };
        const res = await fetchFn(
          'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: id, app_secret: secret }),
          },
        );
        const body = await res.json().catch(() => ({}));
        return body?.code === 0
          ? { ok: true, detail: 'token 换取成功' }
          : { ok: false, detail: `code=${body?.code} ${body?.msg ?? ''}`.trim() };
      },
    },
  ];
}

/** 归并探测结果。任一失活即 degraded —— 探测出错也算失活，宁可误报不可漏报。 */
export function summarizeProbeResults(results) {
  const list = results ?? [];
  const failed = list.filter((r) => !r.ok);
  const parts = failed.map((r) => `${r.name}(${r.detail ?? '未知'})`);
  return {
    status: failed.length === 0 ? 'healthy' : 'degraded',
    failed: failed.map((r) => r.name),
    total: list.length,
    summary: failed.length === 0
      ? `凭据活性全部正常（${list.length} 项）`
      : `凭据失活 ${failed.length}/${list.length}：${parts.join('、')}`,
  };
}

/**
 * auth key 是否该自动续。
 * 不知道到期日时返回 false —— 否则每轮都会重发一把新 key 把旧的冲掉，
 * 制造出"每天换钥匙"的抖动，比不续更糟。
 */
export function shouldRotateAuthKey(days) {
  if (days === null || days === undefined) return false;
  return days <= AUTH_KEY_ROTATE_DAYS;
}

/**
 * 签发一把新的 CI auth key。
 * 能力必须与 CI 现用的一致：reusable（每次跑都是新 runner）+ ephemeral（跑完自动
 * 摘除，否则设备列表会堆满僵尸节点）+ preauthorized（免人工批准）。
 * tailnet 固定用 '-'（默认 tailnet）——1Password 里记的 'xx@gmail.com' 是占位值，
 * 用它调 API 会得到 tailnet not found（2026-09-17 实测）。
 */
export async function issueAuthKey({ fetchFn, apiKey, expiryDays = 90, description = 'cecelia-ci-auto' }) {
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const res = await fetchFn('https://api.tailscale.com/api/v2/tailnet/-/keys', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: { devices: { create: { reusable: true, ephemeral: true, preauthorized: true } } },
      expirySeconds: expiryDays * 24 * 60 * 60,
      description,
    }),
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new Error(`签发 auth key 失败 HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  const body = await res.json();
  if (!body?.key) throw new Error('签发响应里没有 key 字段');
  return { key: body.key, id: body.id, expires: body.expires ?? null };
}

/**
 * 主理人要自己动手的部分。
 * Tailscale 不允许用旧 API token 生成新 API token（安全设计），所以这一件没法自动化——
 * 能做的是提前 EXPIRY_WARN_DAYS 天讲清楚要点哪里，而不是等它挂了再查半天。
 */
export function buildManualActionNotice(apiKeyDays) {
  const cls = classifyExpiry(apiKeyDays);
  if (cls === 'ok') return null;
  const when = cls === 'expired'
    ? `已过期 ${Math.abs(apiKeyDays)} 天`
    : cls === 'unknown' ? '到期日未知' : `还剩 ${apiKeyDays} 天`;
  return [
    `Tailscale API token ${when} —— 这一把只能人工换（Tailscale 不允许旧 token 生成新 token）。`,
    '① 打开 https://login.tailscale.com/admin/settings/keys',
    '② 下半部分 API access tokens → Generate access token（有效期选最长 90 天）',
    '③ 把 tskey-api- 开头的那串发给我，我写回 1Password 并接回自动续期',
    '注：CI 用的 auth key 会自动续，不用管；这把管不了自己，仅此一件。',
  ].join('\n');
}

/**
 * 每日一跑：探活 + 到期体检 + auth key 自动续期。
 *
 * 自 gate 在 scheduler 侧（24h 一次即可）；本函数只负责做事并如实回报，
 * 不吞异常——凭据守卫自己静默失败，比没有守卫更危险。
 *
 * 注入式 IO 便于测试：fetchFn / readSecretFn / writeSecretFn / raiseFn 全可替换。
 */
export async function runCredentialFreshness(deps = {}) {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const raise = deps.raiseFn ?? (async (level, key, msg) => console.warn(`[${level}] ${key}: ${msg}`));

  // ① 活性探测：真去用一次，拿真相（元数据只是声明）
  const results = [];
  for (const p of buildProbePlan()) {
    try {
      results.push({ name: p.name, ...(await p.probe({ fetchFn, env })) });
    } catch (err) {
      results.push({ name: p.name, ok: false, detail: String(err?.message ?? err).slice(0, 80) });
    }
  }
  const probe = summarizeProbeResults(results);
  if (probe.status !== 'healthy') {
    await raise('P1', 'credential_probe_failed', probe.summary);
  }

  // ② 到期体检：元数据用来提前预警
  const authKeyDays = daysUntil(env.TS_AUTHKEY_EXPIRES);
  const apiKeyDays = daysUntil(env.TAILSCALE_API_KEY_EXPIRES);

  // ③ auth key 自动续（API token 有权签发，已实测）
  let rotated = null;
  if (shouldRotateAuthKey(authKeyDays) && env.TAILSCALE_API_KEY) {
    try {
      rotated = await issueAuthKey({ fetchFn, apiKey: env.TAILSCALE_API_KEY });
      await raise('P2', 'tailscale_authkey_rotated',
        `CI auth key 已自动续期（原剩 ${authKeyDays} 天），新 key id=${rotated.id}，需写回 1Password + GHA secret`);
    } catch (err) {
      await raise('P1', 'tailscale_authkey_rotate_failed',
        `auth key 自动续期失败（原剩 ${authKeyDays} 天）：${err.message}`);
    }
  }

  // ④ 只能人工的那一件：提前讲清楚要点哪里
  const manual = buildManualActionNotice(apiKeyDays);
  if (manual) await raise('P1', 'tailscale_api_token_manual', manual);

  return {
    probe,
    expiry: {
      ts_authkey_days: authKeyDays,
      ts_api_key_days: apiKeyDays,
      ts_api_key_class: classifyExpiry(apiKeyDays),
    },
    rotated_auth_key_id: rotated?.id ?? null,
    manual_action_required: Boolean(manual),
  };
}

const GATE_MS = 24 * 60 * 60 * 1000;
let _lastRunAt = 0;
/** 测试用 */
export function _resetCredentialFreshnessGate() { _lastRunAt = 0; }

/** scheduler 入口：每 60s 被调，本函数自 gate 到每日一跑 */
export async function maybeRunCredentialFreshness(_pool, deps = {}) {
  const now = (deps.now ?? Date.now)();
  if (_lastRunAt && now - _lastRunAt < GATE_MS) return { skipped: 'cooldown' };
  _lastRunAt = now;
  return runCredentialFreshness(deps);
}
