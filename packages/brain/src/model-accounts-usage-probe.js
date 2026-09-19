/**
 * model-accounts-usage-probe.js — 模型账号 usage 探针（在凭据所在宿主 mmv 上跑，不在 Brain 容器里跑）
 *
 * 用法（由 ops-model-accounts-collector.js 经 host-exec ssh 投递，脚本本体 base64 走 stdin）：
 *   node --input-type=module - -- --probe-run <provider> <credential_path>
 * 只读凭据文件里的当前 access token / key，调三家官方 usage 接口，**只向 stdout 回传 usage JSON**，
 * 凭据本身绝不回传、绝不打印。
 *
 * 铁律（INV-1）：任何路径不读、不用、不刷新凭据里的 refresh 类字段（Grok 严格复用检测轮换，
 * 脚本刷一次整条链被撤销）。Grok key 过期表现为 grpc-status 7 → 以非零退出 + 明确错误文本上抛，
 * 由采集器归类为 key_expired。
 *
 * 自包含：本文件不得 import 仓内其它模块（它是被整段投递到远端执行的）。
 * 纯函数（归一化/解帧）导出供单测；只有带 --run 参数时才执行 main。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const FETCH_TIMEOUT_MS = 10_000;
const FIVE_HOUR_MAX_WINDOW_SECONDS = 6 * 3600;

export function expandHome(p) {
  const s = String(p || '');
  return s.startsWith('~/') ? `${homedir()}${s.slice(1)}` : s;
}

/** Anthropic oauth/usage 已是 collector parser 认的形状（five_hour.utilization / resets_at），原样透传。 */
export function normalizeAnthropicUsage(raw) {
  return raw && typeof raw === 'object' ? raw : {};
}

function epochOrAfterToIso(win, now = Date.now()) {
  if (!win || typeof win !== 'object') return null;
  if (typeof win.reset_at === 'number' && Number.isFinite(win.reset_at)) {
    return new Date(win.reset_at * 1000).toISOString();
  }
  if (typeof win.reset_after_seconds === 'number' && Number.isFinite(win.reset_after_seconds)) {
    return new Date(now + win.reset_after_seconds * 1000).toISOString();
  }
  return null;
}

/**
 * ChatGPT wham/usage（2026-09-19 实测形状：rate_limit.primary_window/secondary_window，
 * 每窗 used_percent + limit_window_seconds + reset_after_seconds + reset_at 秒级 epoch；窗可为 null）
 * → collector parseChatgptWhamUsage 认的形状 { five_hour:{usage_percent,reset_time}, seven_day:{...} }。
 * 窗归属按 limit_window_seconds 判：≤6h 归 five_hour，其余归 seven_day；没有的窗 → null（诚实留空）。
 */
export function normalizeWhamUsage(raw, now = Date.now()) {
  const rl = raw && typeof raw === 'object' && raw.rate_limit && typeof raw.rate_limit === 'object'
    ? raw.rate_limit : {};
  const windows = [rl.primary_window, rl.secondary_window].filter((w) => w && typeof w === 'object');
  const fiveHour = windows.find((w) => (w.limit_window_seconds ?? 0) <= FIVE_HOUR_MAX_WINDOW_SECONDS) ?? null;
  const sevenDay = windows.find((w) => (w.limit_window_seconds ?? 0) > FIVE_HOUR_MAX_WINDOW_SECONDS) ?? null;
  const toWin = (w) => (w ? {
    usage_percent: typeof w.used_percent === 'number' ? w.used_percent : null,
    reset_time: epochOrAfterToIso(w, now),
  } : null);
  return {
    plan_type: typeof raw?.plan_type === 'string' ? raw.plan_type : null,
    five_hour: toWin(fiveHour),
    seven_day: toWin(sevenDay),
  };
}

/** protobuf varint（返回 [value, bytesRead]）。 */
export function readVarint(buf, offset = 0) {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const b = buf[i];
    i += 1;
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result, i - offset];
}

/** 逐字段解 protobuf（wireType 0/1/2/5），bytes 字段原样保留供上层递归。 */
export function decodeProtoFields(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const [tag, tagLen] = readVarint(buf, i);
    i += tagLen;
    const field = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (wireType === 0) {
      const [v, l] = readVarint(buf, i);
      i += l;
      out.push({ field, wireType, value: v });
    } else if (wireType === 2) {
      const [len, l] = readVarint(buf, i);
      i += l;
      out.push({ field, wireType, bytes: buf.subarray(i, i + len) });
      i += len;
    } else if (wireType === 5) {
      out.push({ field, wireType, value: buf.readUInt32LE(i) });
      i += 4;
    } else if (wireType === 1) {
      out.push({ field, wireType, value: null });
      i += 8;
    } else {
      break;
    }
  }
  return out;
}

/** 剥 gRPC-web 帧（1 字节 flag + 4 字节大端长度）；0x00=data 帧，0x80=trailers 文本帧。 */
export function stripGrpcWebFrames(buf) {
  const frames = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const flag = buf[i];
    const len = buf.readUInt32BE(i + 1);
    frames.push({ flag, payload: buf.subarray(i + 5, i + 5 + len) });
    i += 5 + len;
  }
  return frames;
}

/**
 * Grok GetGrokCreditsConfig 响应体 → collector parseGrokUsage 认的形状。
 * 字段映射（llm-quota 09-03 实测）：data 帧内层 f1 包一层；f4=周期开始、f5=周期结束（proto3 Timestamp，
 * 内嵌 f1=秒）；用量字段按 proto3 默认值省略——**没出现即 0%**。Grok 无 5h 窗，five_hour_pct 恒 null。
 * trailers 非 grpc-status:0 → 抛错（带 grpc-status 文本，采集器据此归类 key_expired/unknown）。
 */
export function normalizeGrokUsage(bodyBuf) {
  const frames = stripGrpcWebFrames(bodyBuf);
  const trailer = frames.find((f) => f.flag === 0x80);
  if (trailer) {
    const text = trailer.payload.toString('utf8');
    if (!/grpc-status:\s*0\b/.test(text)) {
      throw new Error(`grok trailer 非成功: ${text.replace(/\s+/g, ' ').trim()}`);
    }
  }
  const data = frames.find((f) => f.flag === 0x00);
  if (!data) throw new Error('grok 响应无 data 帧（只有 trailers）');
  const top = decodeProtoFields(data.payload);
  const inner = top.find((f) => f.field === 1 && f.wireType === 2);
  const fields = inner ? decodeProtoFields(inner.bytes) : top;
  const tsSeconds = (n) => {
    const f = fields.find((x) => x.field === n && x.wireType === 2);
    if (!f) return null;
    const sec = decodeProtoFields(f.bytes).find((x) => x.field === 1 && x.wireType === 0);
    return sec ? sec.value : null;
  };
  const endSec = tsSeconds(5);
  return {
    five_hour_pct: null,
    seven_day_pct: 0,
    reset_at: endSec ? new Date(endSec * 1000).toISOString() : null,
  };
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readCredential(path) {
  try {
    return JSON.parse(readFileSync(expandHome(path), 'utf8'));
  } catch (err) {
    fail(2, `no_credential: ${err?.code || err?.message || 'unreadable'}`);
    return null;
  }
}

async function probeClaude(path) {
  const creds = readCredential(path);
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) fail(2, 'no_credential: accessToken missing');
  const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) fail(4, `anthropic usage HTTP ${r.status}`);
  return normalizeAnthropicUsage(await r.json());
}

async function probeCodex(path) {
  const auth = readCredential(path);
  const token = auth?.tokens?.access_token;
  const accountId = auth?.tokens?.account_id;
  if (!token) fail(2, 'no_credential: access_token missing');
  const headers = { Authorization: `Bearer ${token}` };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  const r = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) fail(4, `chatgpt wham usage HTTP ${r.status}`);
  return normalizeWhamUsage(await r.json());
}

async function probeGrok(path) {
  const raw = readCredential(path);
  const entry = raw && typeof raw === 'object' ? Object.values(raw)[0] : null;
  const key = entry?.key;
  if (!key) fail(2, 'no_credential: key missing');
  const frame = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
  const r = await fetch('https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/grpc-web+proto', Authorization: `Bearer ${key}`, 'X-Grpc-Web': '1' },
    body: frame,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const gStatus = r.headers.get('grpc-status');
  if (gStatus && gStatus !== '0') {
    const msg = decodeURIComponent(r.headers.get('grpc-message') || '');
    fail(3, `grpc-status: ${gStatus} ${msg}`.trim());
  }
  if (!r.ok) fail(4, `grok billing HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length === 0) fail(3, 'grpc-status: 7 empty body (key 多半已过期)');
  return normalizeGrokUsage(buf);
}

async function main(argv) {
  const [provider, path] = argv;
  if (!provider || !path) fail(64, 'usage: -- --probe-run <provider> <credential_path>');
  const p = String(provider).toLowerCase();
  let out;
  if (/grok/.test(p)) out = await probeGrok(path);
  else if (/codex/.test(p)) out = await probeCodex(path);
  else out = await probeClaude(path);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

// 标记不用 --run：那是 node 自己的 CLI 选项（node --run <npm script>），会被 node 吞掉。
const runIdx = process.argv.indexOf('--probe-run');
if (runIdx !== -1) {
  main(process.argv.slice(runIdx + 1)).catch((err) => fail(5, `probe failed: ${err?.message || err}`));
}
