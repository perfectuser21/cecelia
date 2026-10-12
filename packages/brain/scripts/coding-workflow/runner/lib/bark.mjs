// 主理人通知通道（Bark）：commander 上交与合并门「等人合并」共用。cfg.barkUrl 来自 config.mjs（CODING_WF_BARK_URL 或 BARK_TOKEN 凭据，运行时读）。
const BARK_TIMEOUT_MS = 15000;

/** 推送一条 Bark；送达返回 true。没配置 / 网络失败返回 false，不抛错（调用方记日志）。 */
export async function notifyBark(cfg, title, body) {
  if (!cfg.barkUrl) return false;
  try {
    const res = await fetch(`${cfg.barkUrl.replace(/\/+$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`, { signal: AbortSignal.timeout(BARK_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}
